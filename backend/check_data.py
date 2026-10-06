
import asyncio
import os
import certifi
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

async def check_data():
    # Load env vars
    ROOT_DIR = Path(__file__).parent
    load_dotenv(ROOT_DIR / '.env')
    
    mongo_url = os.environ['MONGO_URL']
    client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where())
    db = client[os.environ['DB_NAME']]
    
    print(f"Connected to Database: {os.environ['DB_NAME']}")
    
    # Count users
    user_count = await db.users.count_documents({})
    print(f"Number of users found: {user_count}")
    
    if user_count > 0:
        print("SUCCESS: Data is being stored in MongoDB.")
        # Print the email of the last registered user
        last_user = await db.users.find_one({}, sort=[('_id', -1)])
        print(f"Last registered user email: {last_user.get('email')}")
    else:
        print("WARNING: Connected, but no users found. Try signing up first.")

if __name__ == "__main__":
    asyncio.run(check_data())
