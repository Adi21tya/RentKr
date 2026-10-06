
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

async def test_connection():
    # Load env vars same as server.py
    ROOT_DIR = Path(__file__).parent
    env_path = ROOT_DIR / '.env'
    print(f"Loading .env from: {env_path}")
    load_dotenv(env_path)
    
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME')
    
    print(f"MONGO_URL: {mongo_url}")
    print(f"DB_NAME: {db_name}")
    
    if not mongo_url:
        print("Error: MONGO_URL not found in environment variables.")
        return
        
    try:
        print("Attempting to connect to MongoDB...")
        client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
        
        # Force a connection verification
        print("Checking server info...")
        info = await client.server_info()
        print(f"Successfully connected to MongoDB version: {info.get('version')}")
        
        db = client[db_name]
        print(f"Accessing database: {db_name}")
        
        # Try a simple find_one
        print("Attempting to read from users collection...")
        user = await db.users.find_one({})
        print("Read successful (even if result is None).")
        
    except Exception as e:
        print(f"\nConnection FAILED!")
        print(f"Error type: {type(e).__name__}")
        print(f"Error message: {str(e)}")
        # Print cause if available
        if hasattr(e, '__cause__') and e.__cause__:
             print(f"Cause: {e.__cause__}")

if __name__ == "__main__":
    asyncio.run(test_connection())
