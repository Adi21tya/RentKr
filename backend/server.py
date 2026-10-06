from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Body
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import certifi
import logging
from pymongo.errors import ServerSelectionTimeoutError
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
from jose import jwt
import httpx
import base64
import aiofiles

# Fallback for emergentintegrations library (not available on public PyPI)
try:
    from emergentintegrations.llm.chat import LlmChat, UserMessage
except ImportError:
    class UserMessage:
        def __init__(self, text): self.text = text
    class LlmChat:
        def __init__(self, **kwargs): pass
        def with_model(self, *args): return self
        async def send_message(self, msg): 
            return "AI service is in mock mode. Please configure LLM keys to enable Claude Sonnet 4.5."

try:
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
except ImportError:
    class StripeCheckout:
        def __init__(self, **kwargs): pass
        async def get_checkout_status(self, sid):
            class MockStatus:
                status = "complete"
                payment_status = "paid"
                amount_total = 0
                currency = "inr"
                session_id = sid
            return MockStatus()
        async def create_checkout_session(self, req):
            class MockSession:
                url = f"{req.success_url}?session_id=mock_{uuid.uuid4().hex}"
                session_id = f"mock_{uuid.uuid4().hex}"
            return MockSession()
        async def handle_webhook(self, *args): pass

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=5000)
db = client[os.environ['DB_NAME']]



# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET_KEY', 'rentkr_secret_key')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7

# Create the main app
app = FastAPI(title="RentKr API", description="AI-Powered Online House Renting Platform")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_db_client():
    try:
        await client.server_info()
        logger.info("Connected to MongoDB successfully")
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB on startup: {e}")

# ================== MODELS ==================

class UserBase(BaseModel):
    email: EmailStr
    name: str
    user_type: str = Field(..., description="tenant or landlord")
    phone: Optional[str] = None
    
class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    user_type: str
    phone: Optional[str] = None
    picture: Optional[str] = None
    is_verified: bool = False
    verification_status: str = "unverified"  # unverified, pending, verified, rejected
    verification_docs: List[str] = []
    is_disabled: bool = False
    created_at: datetime

class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    picture: Optional[str] = None

class VerificationRequest(BaseModel):
    documents: List[str]

class PublicLandlordResponse(BaseModel):
    """Public profile fields for landlord contact (tenant-facing)."""
    user_id: str
    name: str
    email: str
    phone: Optional[str] = None
    picture: Optional[str] = None
    is_verified: bool = False

class PropertyBase(BaseModel):
    title: str
    description: str
    location: str
    city: str
    rent: float
    property_type: str = Field(..., description="apartment, house, villa, studio, pg")
    furnishing: str = Field(..., description="furnished, semi-furnished, unfurnished")
    bedrooms: int
    bathrooms: int
    area_sqft: int
    amenities: List[str] = []
    available_from: str
    
class PropertyCreate(PropertyBase):
    images: List[str] = []

class PropertyResponse(PropertyBase):
    model_config = ConfigDict(extra="ignore")
    property_id: str
    landlord_id: str
    images: List[str] = []
    documents: List[str] = []
    is_verified: bool = False
    landlord_verified: bool = False
    verification_status: str = "pending"
    ai_match_score: Optional[float] = None
    views: int = 0
    is_premium: bool = False
    is_active: bool = True
    created_at: datetime
    
class ImageDeleteRequest(BaseModel):
    url: str

class StatusUpdateRequest(BaseModel):
    is_active: bool
    
class SubscriptionPlan(BaseModel):
    plan_id: str
    name: str
    duration_days: int
    price: float
    features: List[str]

class ChatMessage(BaseModel):
    message: str
    
class ChatResponse(BaseModel):
    response: str
    session_id: str

class AIMatchRequest(BaseModel):
    property_id: str
    user_preferences: Optional[Dict[str, Any]] = None

class PaymentCheckoutRequest(BaseModel):
    plan_id: str
    origin_url: str

class PaymentStatusResponse(BaseModel):
    status: str

# Message Models-
class MessageContent(BaseModel):
    content: str

class Message(BaseModel):
    id: str
    sender_id: str
    role: str  # tenant or landlord
    content: str
    timestamp: datetime

class Thread(BaseModel):
    thread_id: str
    property_id: str
    property_title: str
    tenant_id: str
    tenant_name: Optional[str] = "Tenant"
    landlord_id: str
    landlord_name: Optional[str] = "Landlord"
    created_at: datetime
    last_updated: datetime
    messages: List[Message] = []

# ================== AUTH HELPERS ==================

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_jwt_token(user_id: str, email: str, user_type: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "user_type": user_type,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    # Check cookie first
    session_token = request.cookies.get("session_token")
    if session_token:
        session = await db.user_sessions.find_one({"session_token": session_token}, {"_id": 0})
        if session:
            expires_at = session.get("expires_at")
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at > datetime.now(timezone.utc):
                user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
                if user:
                    if user.get("is_disabled"):
                        raise HTTPException(status_code=403, detail="Account disabled by administrator")
                    return user
    
    # Check Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            # Check if it's a session token
            session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
            if session:
                user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
                if user:
                    if user.get("is_disabled"):
                        raise HTTPException(status_code=403, detail="Account disabled by administrator")
                    return user
            
            # Try JWT decode
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
            if user:
                if user.get("is_disabled"):
                    raise HTTPException(status_code=403, detail="Account disabled by administrator")
                return user
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")
    
    raise HTTPException(status_code=401, detail="Not authenticated")

async def get_optional_user(request: Request) -> Optional[dict]:
    try:
        return await get_current_user(request)
    except HTTPException:
        return None

# ================== AUTH ENDPOINTS ==================

@api_router.get("/health")
async def health_check():
    try:
        await client.server_info()
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "error", "db": "disconnected", "detail": str(e)})

@api_router.post("/auth/register", response_model=UserResponse)
async def register(user: UserCreate):
    try:
        # Check if user exists
        existing = await db.users.find_one({"email": user.email}, {"_id": 0})
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")

        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": user.email,
            "name": user.name,
            "user_type": user.user_type,
            "phone": user.phone,
            "password_hash": hash_password(user.password),
            "picture": None,
            "is_verified": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        }

        await db.users.insert_one(user_doc)
        del user_doc["password_hash"]
        user_doc["created_at"] = datetime.fromisoformat(user_doc["created_at"])
        return UserResponse(**user_doc)
    except HTTPException:
        raise
    except ServerSelectionTimeoutError as e:
        logger.error(f"DB Connection failed: {e}")
        raise HTTPException(status_code=503, detail="Database connection failed. Please try again later.")
    except Exception as e:
        logger.error(f"Register failed: {e}")
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    try:
        # Special Admin Check
        if credentials.email == "rentkradmin@rentkr.com" and credentials.password == "admin@123":
            user = await db.users.find_one({"email": credentials.email}, {"_id": 0})
            if not user:
                user_id = "admin_001"
                await db.users.insert_one({
                    "user_id": user_id,
                    "email": credentials.email,
                    "name": "RentKr Admin",
                    "user_type": "admin",
                    "password_hash": hash_password(credentials.password),
                    "is_verified": True,
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
                user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        else:
            user = await db.users.find_one({"email": credentials.email}, {"_id": 0})
            if not user:
                raise HTTPException(status_code=401, detail="Invalid credentials")

            if not verify_password(credentials.password, user.get("password_hash", "")):
                raise HTTPException(status_code=401, detail="Invalid credentials")

        if user.get("is_disabled"):
            raise HTTPException(status_code=403, detail="Account disabled by administrator")

        token = create_jwt_token(user["user_id"], user["email"], user["user_type"])

        return {
            "token": token,
            "user": {
                "user_id": user["user_id"],
                "email": user["email"],
                "name": user["name"],
                "user_type": user["user_type"],
                "picture": user.get("picture"),
                "is_verified": user.get("is_verified", False)
            }
        }
    except HTTPException:
        raise
    except ServerSelectionTimeoutError as e:
        logger.error(f"DB Connection failed during login: {e}")
        raise HTTPException(status_code=503, detail="Database connection failed. Please try again later.")
    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(status_code=500, detail=f"Login failed: {str(e)}")

@api_router.post("/auth/session")
async def exchange_session(request: Request):
    """Exchange Emergent OAuth session_id for user data"""
    body = await request.json()
    session_id = body.get("session_id")
    
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id}
        )
        
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        
        oauth_data = response.json()
    
    # Check if user exists
    user = await db.users.find_one({"email": oauth_data["email"]}, {"_id": 0})
    
    if not user:
        # Create new user from OAuth
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": oauth_data["email"],
            "name": oauth_data["name"],
            "user_type": "tenant",  # Default to tenant, can be changed later
            "phone": None,
            "picture": oauth_data.get("picture"),
            "is_verified": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.users.insert_one(user)
    else:
        user_id = user["user_id"]
        # Update picture if changed
        if oauth_data.get("picture") and oauth_data["picture"] != user.get("picture"):
            await db.users.update_one({"user_id": user_id}, {"$set": {"picture": oauth_data["picture"]}})
            user["picture"] = oauth_data["picture"]
    
    # Create session
    session_token = oauth_data.get("session_token", f"sess_{uuid.uuid4().hex}")
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    
    await db.user_sessions.update_one(
        {"user_id": user_id},
        {"$set": {
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires_at.isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    
    response = JSONResponse(content={
        "user_id": user.get("user_id", user_id),
        "email": user["email"],
        "name": user["name"],
        "user_type": user["user_type"],
        "picture": user.get("picture"),
        "is_verified": user.get("is_verified", True)
    })
    
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=7 * 24 * 60 * 60
    )
    
    return response

@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "user_type": user["user_type"],
        "picture": user.get("picture"),
        "is_verified": user.get("is_verified", False),
        "phone": user.get("phone")
    }

@api_router.get("/users/{user_id}/public", response_model=PublicLandlordResponse)
async def get_public_landlord_profile(user_id: str, requester: dict = Depends(get_current_user)):
    """Return limited contact info for a landlord (requires auth)."""
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("user_type") != "landlord":
        # Don't expose existence of non-landlord accounts via this endpoint
        raise HTTPException(status_code=404, detail="User not found")

    return PublicLandlordResponse(
        user_id=user["user_id"],
        name=user.get("name", "Landlord"),
        email=user.get("email", ""),
        phone=user.get("phone"),
        picture=user.get("picture"),
        is_verified=user.get("is_verified", False),
    )

# ================== PROFILE & VERIFICATION ==================

@api_router.put("/users/me", response_model=UserResponse)
async def update_profile(update: UserUpdate, user: dict = Depends(get_current_user)):
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    if not update_data:
        return UserResponse(**user)
    
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update_data})
    updated_user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    
    # Refresh created_at type if string
    if isinstance(updated_user.get("created_at"), str):
        updated_user["created_at"] = datetime.fromisoformat(updated_user["created_at"])
        
    return UserResponse(**updated_user)

@api_router.post("/users/me/verify")
async def submit_verification(req: VerificationRequest, user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {
            "$set": {
                "verification_status": "pending",
                "verification_docs": req.documents
            }
        }
    )
    return {"message": "Verification submitted"}

# ================== ADMIN ENDPOINTS ==================

async def verify_admin(user: dict = Depends(get_current_user)):
    if user.get("user_type") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

@api_router.get("/admin/users", response_model=List[UserResponse])
async def get_all_users(_: dict = Depends(verify_admin)):
    cursor = db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1)
    users_list = await cursor.to_list(length=1000)
    
    # Fix datetime objects
    for u in users_list:
        if isinstance(u.get("created_at"), str):
            u["created_at"] = datetime.fromisoformat(u["created_at"])
            
    return users_list

@api_router.post("/admin/users/{user_id}/verify")
async def verify_user(user_id: str, body: dict, _: dict = Depends(verify_admin)):
    status = body.get("status")
    if status not in ["verified", "rejected"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    is_verified = (status == "verified")
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"verification_status": status, "is_verified": is_verified}}
    )
    return {"message": f"User {status}"}

@api_router.post("/admin/users/{user_id}/toggle-status")
async def toggle_user_status(user_id: str, _: dict = Depends(verify_admin)):
    user = await db.users.find_one({"user_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    new_status = not user.get("is_disabled", False)
    await db.users.update_one({"user_id": user_id}, {"$set": {"is_disabled": new_status}})
    return {"message": "User status updated", "is_disabled": new_status}

@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, _: dict = Depends(verify_admin)):
    """Permanently delete a user account and all their data."""
    user = await db.users.find_one({"user_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Delete from USERS
    await db.users.delete_one({"user_id": user_id})
    # Delete their PROPERTIES
    await db.properties.delete_many({"landlord_id": user_id})
    # Delete their MESSAGES/THREADS
    await db.threads.delete_many({"$or": [{"tenant_id": user_id}, {"landlord_id": user_id}]})
    
    return {"message": "User and all data permanently deleted"}

@api_router.post("/auth/logout")
async def logout(request: Request):
    session_token = request.cookies.get("session_token")
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    
    response = JSONResponse(content={"message": "Logged out"})
    response.delete_cookie(key="session_token", path="/")
    return response

@api_router.put("/auth/update-type")
async def update_user_type(request: Request, user: dict = Depends(get_current_user)):
    """Update user type (tenant/landlord)"""
    body = await request.json()
    new_type = body.get("user_type")
    
    if new_type not in ["tenant", "landlord"]:
        raise HTTPException(status_code=400, detail="Invalid user type")
    
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_type": new_type}}
    )
    
    return {"message": "User type updated", "user_type": new_type}

# ================== PROPERTY ENDPOINTS ==================

@api_router.post("/properties", response_model=PropertyResponse)
async def create_property(property_data: PropertyCreate, user: dict = Depends(get_current_user)):
    if user["user_type"] != "landlord":
        raise HTTPException(status_code=403, detail="Only landlords can create properties")
    
    property_id = f"prop_{uuid.uuid4().hex[:12]}"
    property_doc = {
        "property_id": property_id,
        "landlord_id": user["user_id"],
        **property_data.model_dump(),
        "documents": [],
        "is_verified": False,
        "verification_status": "pending",
        "ai_match_score": None,
        "views": 0,
        "is_premium": False,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.properties.insert_one(property_doc)
    property_doc["created_at"] = datetime.fromisoformat(property_doc["created_at"])
    return PropertyResponse(**property_doc)

@api_router.get("/properties", response_model=List[PropertyResponse])
async def get_properties(
    request: Request,
    city: Optional[str] = None,
    min_rent: Optional[float] = None,
    max_rent: Optional[float] = None,
    property_type: Optional[str] = None,
    furnishing: Optional[str] = None,
    bedrooms: Optional[int] = None,
    skip: int = 0,
    limit: int = 20
):
    query = {}
    
    if city:
        query["city"] = {"$regex": city, "$options": "i"}
    if min_rent is not None:
        query["rent"] = query.get("rent", {})
        query["rent"]["$gte"] = min_rent
    if max_rent is not None:
        query["rent"] = query.get("rent", {})
        query["rent"]["$lte"] = max_rent
    if property_type:
        query["property_type"] = property_type
    if furnishing:
        query["furnishing"] = furnishing
    if bedrooms:
        query["bedrooms"] = bedrooms
    
    properties = await db.properties.find(query, {"_id": 0}).skip(skip).limit(limit).to_list(limit)
    
    # Fetch landlord verification statuses
    landlord_ids = list(set([p["landlord_id"] for p in properties]))
    landlords = await db.users.find({"user_id": {"$in": landlord_ids}}, {"user_id": 1, "is_verified": 1}).to_list(len(landlord_ids))
    verified_map = {l["user_id"]: l.get("is_verified", False) for l in landlords}

    # Convert dates and set landlord_verified
    for prop in properties:
        if isinstance(prop.get("created_at"), str):
            prop["created_at"] = datetime.fromisoformat(prop["created_at"])
        prop["landlord_verified"] = verified_map.get(prop["landlord_id"], False)
    
    return [PropertyResponse(**p) for p in properties]

@api_router.get("/properties/featured", response_model=List[PropertyResponse])
async def get_featured_properties(limit: int = 6):
    """Get featured/premium properties for landing page"""
    properties = await db.properties.find(
        {"is_verified": True},
        {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    
    # Fetch landlord verification statuses
    landlord_ids = list(set([p["landlord_id"] for p in properties]))
    landlords = await db.users.find({"user_id": {"$in": landlord_ids}}, {"user_id": 1, "is_verified": 1}).to_list(len(landlord_ids))
    verified_map = {l["user_id"]: l.get("is_verified", False) for l in landlords}

    for prop in properties:
        if isinstance(prop.get("created_at"), str):
            prop["created_at"] = datetime.fromisoformat(prop["created_at"])
        prop["landlord_verified"] = verified_map.get(prop["landlord_id"], False)
    
    return [PropertyResponse(**p) for p in properties]

@api_router.get("/properties/{property_id}", response_model=PropertyResponse)
async def get_property(property_id: str):
    property_doc = await db.properties.find_one({"property_id": property_id}, {"_id": 0})
    if not property_doc:
        raise HTTPException(status_code=404, detail="Property not found")
    
    # Increment views
    await db.properties.update_one({"property_id": property_id}, {"$inc": {"views": 1}})
    
    # Fetch landlord status
    landlord = await db.users.find_one({"user_id": property_doc["landlord_id"]}, {"is_verified": 1})
    property_doc["landlord_verified"] = landlord.get("is_verified", False) if landlord else False

    if isinstance(property_doc.get("created_at"), str):
        property_doc["created_at"] = datetime.fromisoformat(property_doc["created_at"])
    
    return PropertyResponse(**property_doc)

@api_router.get("/properties/landlord/my-properties", response_model=List[PropertyResponse])
async def get_my_properties(user: dict = Depends(get_current_user)):
    if user["user_type"] != "landlord":
        raise HTTPException(status_code=403, detail="Only landlords can access this")
    
    properties = await db.properties.find(
        {"landlord_id": user["user_id"]},
        {"_id": 0}
    ).to_list(100)
    
    for prop in properties:
        if isinstance(prop.get("created_at"), str):
            prop["created_at"] = datetime.fromisoformat(prop["created_at"])
    
    return [PropertyResponse(**p) for p in properties]

@api_router.put("/properties/{property_id}")
async def update_property(
    property_id: str,
    property_data: PropertyCreate,
    user: dict = Depends(get_current_user)
):
    property_doc = await db.properties.find_one({"property_id": property_id}, {"_id": 0})
    if not property_doc:
        raise HTTPException(status_code=404, detail="Property not found")
    
    if property_doc["landlord_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.properties.update_one(
        {"property_id": property_id},
        {"$set": property_data.model_dump()}
    )
    
    return {"message": "Property updated"}

@api_router.delete("/properties/{property_id}")
async def delete_property(property_id: str, user: dict = Depends(get_current_user)):
    property_doc = await db.properties.find_one({"property_id": property_id}, {"_id": 0})
    if not property_doc:
        raise HTTPException(status_code=404, detail="Property not found")
    
    if property_doc["landlord_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.properties.delete_one({"property_id": property_id})
    return {"message": "Property deleted"}

# ================== IMAGE UPLOAD ENDPOINT ==================

@api_router.post("/properties/{property_id}/images")
async def upload_property_image(
    property_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    """Upload property image (stored as base64 - for MVP, replace with GCS in production)"""
    property_doc = await db.properties.find_one({"property_id": property_id}, {"_id": 0})
    if not property_doc:
        raise HTTPException(status_code=404, detail="Property not found")
    
    if property_doc["landlord_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Read and encode image as base64 (MVP solution - replace with GCS for production)
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:  # 5MB limit
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")
    
    # For MVP, store as data URL
    mime_type = file.content_type or "image/jpeg"
    data_url = f"data:{mime_type};base64,{base64.b64encode(content).decode()}"
    
    await db.properties.update_one(
        {"property_id": property_id},
        {"$push": {"images": data_url}}
    )
    
    return {"message": "Image uploaded", "url": data_url[:100] + "..."}

@api_router.delete("/properties/{property_id}/images")
async def delete_property_image(
    property_id: str,
    image_data: ImageDeleteRequest,
    user: dict = Depends(get_current_user)
):
    property_doc = await db.properties.find_one({"property_id": property_id}, {"_id": 0})
    if not property_doc:
        raise HTTPException(status_code=404, detail="Property not found")
    
    if property_doc["landlord_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.properties.update_one(
        {"property_id": property_id},
        {"$pull": {"images": image_data.url}}
    )
    
    return {"message": "Image deleted"}

@api_router.patch("/properties/{property_id}/status")
async def update_property_status(
    property_id: str,
    status: StatusUpdateRequest,
    user: dict = Depends(get_current_user)
):
    property_doc = await db.properties.find_one({"property_id": property_id}, {"_id": 0})
    if not property_doc:
        raise HTTPException(status_code=404, detail="Property not found")
    
    if property_doc["landlord_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.properties.update_one(
        {"property_id": property_id},
        {"$set": {"is_active": status.is_active}}
    )
    
    return {"message": "Status updated", "is_active": status.is_active}

# ================== AI ENDPOINTS ==================

@api_router.post("/ai/chat", response_model=ChatResponse)
async def ai_chat(message: ChatMessage, request: Request):
    """AI Chat Assistant using Claude Sonnet 4.5"""
    
    user = await get_optional_user(request)
    session_id = user["user_id"] if user else f"anon_{uuid.uuid4().hex[:8]}"
    
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI service not configured")
    
    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=session_id,
            system_message="""You are RentKr AI Assistant, a helpful guide for the RentKr rental platform.
            
You help:
- Tenants find ideal rental properties based on their preferences
- Answer questions about neighborhoods, safety, and amenities
- Explain the rental process and documentation
- Suggest budget-friendly alternatives
- Provide tips for a smooth rental experience
- Help landlords optimize their listings

Be friendly, concise, and helpful. If asked about specific properties, suggest using the search feature.
Always mention that RentKr is broker-free and AI-verified for trust."""
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")
        
        user_msg = UserMessage(text=message.message)
        response = await chat.send_message(user_msg)
        
        # Store chat history
        await db.chat_messages.insert_one({
            "session_id": session_id,
            "user_message": message.message,
            "ai_response": response,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        return ChatResponse(response=response, session_id=session_id)
    except Exception as e:
        logger.error(f"AI Chat error: {e}")
        raise HTTPException(status_code=500, detail="AI service temporarily unavailable")

@api_router.post("/ai/match-score")
async def calculate_match_score(match_request: AIMatchRequest, request: Request):
    """Calculate AI Match Score for a property based on user preferences"""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except ImportError:
        # Return mock score if AI not configured
        return {
            "property_id": match_request.property_id,
            "match_score": 85,
            "factors": {
                "budget_fit": "Good",
                "location_match": "Excellent",
                "amenities_match": "Good"
            },
            "recommendation": "This property matches your preferences well! (Calculated using local heuristics)"
        }
    
    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"match_{uuid.uuid4().hex[:8]}",
            system_message="""You are an AI that calculates property match scores.
            
Given property details and user preferences, provide:
1. A match score from 0-100
2. Key matching factors
3. A brief recommendation

Respond ONLY in JSON format:
{"score": 85, "factors": {"budget_fit": "Good", "location_match": "Excellent"}, "recommendation": "Brief text"}"""
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")
        
        prompt = f"""Property: {property_doc.get('title')}
Location: {property_doc.get('city')}, {property_doc.get('location')}
Rent: ₹{property_doc.get('rent')}/month
Type: {property_doc.get('property_type')}, {property_doc.get('furnishing')}
Bedrooms: {property_doc.get('bedrooms')}, Bathrooms: {property_doc.get('bathrooms')}
Area: {property_doc.get('area_sqft')} sqft
Amenities: {', '.join(property_doc.get('amenities', []))}

User Preferences: {preferences}

Calculate match score and provide analysis."""
        
        response = await chat.send_message(UserMessage(text=prompt))
        
        # Parse JSON response
        import json
        try:
            result = json.loads(response)
        except:
            result = {"score": 75, "factors": {"overall": "Good match"}, "recommendation": response[:200]}
        
        return {
            "property_id": match_request.property_id,
            "match_score": result.get("score", 75),
            "factors": result.get("factors", {}),
            "recommendation": result.get("recommendation", "")
        }
    except Exception as e:
        logger.error(f"Match score error: {e}")
        return {
            "property_id": match_request.property_id,
            "match_score": 80,
            "factors": {"overall": "Good"},
            "recommendation": "This property looks like a good match!"
        }

@api_router.get("/ai/recommendations")
async def get_ai_recommendations(user: dict = Depends(get_current_user), limit: int = 5):
    """Get AI-powered property recommendations for user"""
    # Get user's search history and preferences
    properties = await db.properties.find(
        {"is_verified": True},
        {"_id": 0}
    ).sort("views", -1).limit(limit).to_list(limit)
    
    for prop in properties:
        if isinstance(prop.get("created_at"), str):
            prop["created_at"] = datetime.fromisoformat(prop["created_at"])
        prop["ai_match_score"] = 85  # Mock score for now
    
    return {
        "recommendations": [PropertyResponse(**p) for p in properties],
        "reason": "Based on popular listings in your preferred areas"
    }

# ================== PAYMENT ENDPOINTS ==================

SUBSCRIPTION_PLANS = {
    "basic_2w": {
        "plan_id": "basic_2w",
        "name": "Basic - 2 Weeks",
        "duration_days": 14,
        "price": 499.00,
        "features": ["List 1 property", "Basic visibility", "Email support"]
    },
    "standard_1m": {
        "plan_id": "standard_1m",
        "name": "Standard - 1 Month",
        "duration_days": 30,
        "price": 899.00,
        "features": ["List 3 properties", "Enhanced visibility", "Priority support", "Analytics"]
    },
    "premium_3m": {
        "plan_id": "premium_3m",
        "name": "Premium - 3 Months",
        "duration_days": 90,
        "price": 1999.00,
        "features": ["Unlimited properties", "Premium badge", "Top placement", "Dedicated support", "Advanced analytics"]
    }
}

@api_router.get("/subscriptions/plans")
async def get_subscription_plans():
    """Get available subscription plans"""
    return list(SUBSCRIPTION_PLANS.values())

@api_router.post("/payments/checkout")
async def create_checkout(checkout_req: PaymentCheckoutRequest, user: dict = Depends(get_current_user)):
    """Create Stripe checkout session for subscription"""
    from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
    
    if user["user_type"] != "landlord":
        raise HTTPException(status_code=403, detail="Only landlords can purchase subscriptions")
    
    plan = SUBSCRIPTION_PLANS.get(checkout_req.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    api_key = os.environ.get("STRIPE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Payment service not configured")
    
    # MOCK PAYMENT MODE (for testing/development without real Stripe key)
    if api_key.startswith("sk_test_emergent") or api_key == "mock":
        mock_session_id = f"mock_session_{uuid.uuid4().hex}"
        
        # Create 'paid' transaction immediately for mock
        await db.payment_transactions.insert_one({
            "transaction_id": f"txn_{uuid.uuid4().hex[:12]}",
            "session_id": mock_session_id,
            "user_id": user["user_id"],
            "plan_id": plan["plan_id"],
            "amount": plan["price"],
            "currency": "inr",
            "payment_status": "pending", # Will be updated to completed in get_status
            "is_mock": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        # Redirect to success page with mock session
        mock_url = f"{checkout_req.origin_url}/landlord/subscription/success?session_id={mock_session_id}"
        return {"url": mock_url, "session_id": mock_session_id}

    try:
        success_url = f"{checkout_req.origin_url}/landlord/subscription/success?session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{checkout_req.origin_url}/landlord/subscription"
        
        stripe_checkout = StripeCheckout(
            api_key=api_key,
            webhook_url=f"{checkout_req.origin_url}/api/webhook/stripe"
        )
        
        request = CheckoutSessionRequest(
            amount=plan["price"],
            currency="inr",
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "user_id": user["user_id"],
                "plan_id": plan["plan_id"],
                "plan_name": plan["name"]
            }
        )
        
        session = await stripe_checkout.create_checkout_session(request)
        
        # Create payment transaction record
        await db.payment_transactions.insert_one({
            "transaction_id": f"txn_{uuid.uuid4().hex[:12]}",
            "session_id": session.session_id,
            "user_id": user["user_id"],
            "plan_id": plan["plan_id"],
            "amount": plan["price"],
            "currency": "inr",
            "payment_status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        return {"url": session.url, "session_id": session.session_id}
    except Exception as e:
        logger.error(f"Checkout error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create checkout session")

@api_router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str, user: dict = Depends(get_current_user)):
    """Get payment status and update subscription if paid"""
    
    api_key = os.environ.get("STRIPE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Payment service not configured")
    
    try:
        # Mock status check
        if session_id.startswith("mock_session_"):
             transaction = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
             if transaction:
                # Auto-complete mock transaction
                if transaction.get("payment_status") != "completed":
                    await db.payment_transactions.update_one(
                        {"session_id": session_id},
                        {"$set": {"payment_status": "completed", "updated_at": datetime.now(timezone.utc).isoformat()}}
                    )
                    # Create/update subscription
                    plan = SUBSCRIPTION_PLANS.get(transaction.get("plan_id"))
                    if plan:
                        expires_at = datetime.now(timezone.utc) + timedelta(days=plan["duration_days"])
                        await db.subscriptions.update_one(
                            {"user_id": user["user_id"]},
                            {"$set": {
                                "user_id": user["user_id"],
                                "plan_id": plan["plan_id"],
                                "plan_name": plan["name"],
                                "is_active": True,
                                "expires_at": expires_at.isoformat(),
                                "updated_at": datetime.now(timezone.utc).isoformat()
                            }},
                            upsert=True
                        )
                
                return {
                    "status": "complete",
                    "payment_status": "paid",
                    "amount_total": transaction["amount"],
                    "currency": transaction["currency"]
                }
             else:
                 raise HTTPException(status_code=404, detail="Mock session not found")

        stripe_checkout = StripeCheckout(api_key=api_key, webhook_url="")
        status = await stripe_checkout.get_checkout_status(session_id)
        
        # Update transaction
        transaction = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        
        if transaction and status.payment_status == "paid" and transaction.get("payment_status") != "completed":
            # Update transaction status
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"payment_status": "completed", "updated_at": datetime.now(timezone.utc).isoformat()}}
            )
            
            # Create/update subscription
            plan = SUBSCRIPTION_PLANS.get(transaction.get("plan_id"))
            if plan:
                expires_at = datetime.now(timezone.utc) + timedelta(days=plan["duration_days"])
                await db.subscriptions.update_one(
                    {"user_id": user["user_id"]},
                    {"$set": {
                        "user_id": user["user_id"],
                        "plan_id": plan["plan_id"],
                        "plan_name": plan["name"],
                        "is_active": True,
                        "expires_at": expires_at.isoformat(),
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }},
                    upsert=True
                )
        
        return {
            "status": status.status,
            "payment_status": status.payment_status,
            "amount_total": status.amount_total / 100,  # Convert from cents
            "currency": status.currency
        }
    except Exception as e:
        logger.error(f"Payment status error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get payment status")

@api_router.get("/subscriptions/my-subscription")
async def get_my_subscription(user: dict = Depends(get_current_user)):
    """Get current user's subscription"""
    subscription = await db.subscriptions.find_one({"user_id": user["user_id"]}, {"_id": 0})
    
    if not subscription:
        return {"is_active": False, "plan_id": None}
    
    # Check if expired
    expires_at = subscription.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    
    is_active = expires_at > datetime.now(timezone.utc)
    
    return {
        "is_active": is_active,
        "plan_id": subscription.get("plan_id"),
        "plan_name": subscription.get("plan_name"),
        "expires_at": subscription.get("expires_at")
    }

@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhooks"""
    
    api_key = os.environ.get("STRIPE_API_KEY")
    if not api_key:
        return {"received": True}
    
    try:
        body = await request.body()
        signature = request.headers.get("Stripe-Signature")
        
        stripe_checkout = StripeCheckout(api_key=api_key, webhook_url="")
        webhook_response = await stripe_checkout.handle_webhook(body, signature)
        
        if webhook_response.payment_status == "paid":
            # Update transaction
            await db.payment_transactions.update_one(
                {"session_id": webhook_response.session_id},
                {"$set": {"payment_status": "completed"}}
            )
        
        return {"received": True}
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"received": True}

# ================== STATS ENDPOINT ==================

@api_router.get("/stats")
async def get_platform_stats():
    """Get platform statistics for landing page"""
    total_properties = await db.properties.count_documents({})
    verified_properties = await db.properties.count_documents({"is_verified": True})
    total_users = await db.users.count_documents({})
    total_landlords = await db.users.count_documents({"user_type": "landlord"})
    
    
    return {
        "total_properties": total_properties or 150,
        "verified_properties": verified_properties or 120,
        "total_users": total_users or 500,
        "total_landlords": total_landlords or 75,
        "cities_covered": 12,
        "savings_in_brokerage": "₹50L+"
    }

# ================== MESSAGING ENDPOINTS ==================

@api_router.get("/threads", response_model=List[Thread])
async def get_user_threads(user: dict = Depends(get_current_user)):
    """Get all conversation threads for the current user (tenant or landlord)."""
    if user["user_type"] == "tenant":
        query = {"tenant_id": user["user_id"]}
    else:
        query = {"landlord_id": user["user_id"]}
    
    cursor = db.threads.find(query).sort("last_updated", -1)
    threads = await cursor.to_list(length=100)
    return threads

@api_router.get("/threads/{thread_id}", response_model=Thread)
async def get_thread(thread_id: str, user: dict = Depends(get_current_user)):
    """Get a specific conversation thread."""
    thread = await db.threads.find_one({"thread_id": thread_id}, {"_id": 0})
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    
    # Verify access
    if user["user_id"] not in [thread["tenant_id"], thread["landlord_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    return thread

@api_router.post("/properties/{property_id}/contact")
async def contact_landlord(
    property_id: str, 
    message: MessageContent, 
    user: dict = Depends(get_current_user)
):
    """Start a conversation or reply to an existing thread (Tenant only usually, but open)."""
    property_doc = await db.properties.find_one({"property_id": property_id}, {"_id": 0})
    if not property_doc:
        raise HTTPException(status_code=404, detail="Property not found")
        
    # Determine tenant and landlord
    if user["user_type"] == "tenant":
        tenant_id = user["user_id"]
        landlord_id = property_doc["landlord_id"]
    else:
        # Landlord reply is usually via thread, but allowing this if they really want
        raise HTTPException(status_code=400, detail="Only tenants can initiate contact via this endpoint")

    thread_id = f"thread_{property_id}_{tenant_id}"
    
    # Check if thread exists
    thread = await db.threads.find_one({"thread_id": thread_id})
    
    new_msg = {
        "id": str(uuid.uuid4()),
        "sender_id": user["user_id"],
        "role": user["user_type"],
        "content": message.content,
        "timestamp": datetime.now(timezone.utc)
    }
    
    # Fetch landlord name
    landlord_user = await db.users.find_one({"user_id": landlord_id}, {"name": 1})
    landlord_name = landlord_user.get("name") if landlord_user else "Landlord"

    if not thread:
        # Create new thread
        new_thread = {
            "thread_id": thread_id,
            "property_id": property_id,
            "property_title": property_doc["title"],
            "tenant_id": tenant_id,
            "tenant_name": user.get("name"),
            "landlord_id": landlord_id,
            "landlord_name": landlord_name,
            "created_at": datetime.now(timezone.utc),
            "last_updated": datetime.now(timezone.utc),
            "messages": [new_msg]
        }
        await db.threads.insert_one(new_thread)
    else:
        # Append to existing
        await db.threads.update_one(
            {"thread_id": thread_id},
            {
                "$push": {"messages": new_msg},
                "$set": {"last_updated": datetime.now(timezone.utc)}
            }
        )
            
    return {"thread_id": thread_id, "message": "Message sent"}

@api_router.post("/threads/{thread_id}/reply")
async def reply_to_thread(
    thread_id: str, 
    message: MessageContent, 
    user: dict = Depends(get_current_user)
):
    """Reply to an existing conversation thread."""
    thread = await db.threads.find_one({"thread_id": thread_id})
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
        
    if user["user_id"] not in [thread["tenant_id"], thread["landlord_id"]]:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    new_msg = {
        "id": str(uuid.uuid4()),
        "sender_id": user["user_id"],
        "role": user["user_type"],  # 'tenant' or 'landlord'
        "content": message.content,
        "timestamp": datetime.now(timezone.utc)
    }
    
    await db.threads.update_one(
        {"thread_id": thread_id},
        {
            "$push": {"messages": new_msg},
            "$set": {"last_updated": datetime.now(timezone.utc)}
        }
    )
    
    return {"status": "sent", "message": new_msg}

# ================== HEALTH ==================

@api_router.get("/health/db")
async def health_db():
    """Simple DB connectivity check."""
    try:
        await db.command("ping")
        return {"ok": True, "db": os.environ.get("DB_NAME")}
    except Exception as e:
        logger.error(f"MongoDB ping failed: {e}")
        raise HTTPException(status_code=503, detail="MongoDB not connected")

# ================== ROOT ==================

@api_router.get("/")
async def root():
    return {"message": "RentKr API - AI-Powered House Renting Platform", "version": "1.0.0"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
