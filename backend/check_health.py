
import requests
import time
import sys

def check_health():
    url = "http://localhost:8000/api/health"
    print(f"Checking {url}...")
    try:
        response = requests.get(url, timeout=5)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text}")
        if response.status_code == 200:
            print("Backend is healthy!")
        else:
            print("Backend returned non-200 status.")
    except Exception as e:
        print(f"Failed to connect: {e}")

if __name__ == "__main__":
    # Wait a bit for server to start if just launched
    time.sleep(2) 
    check_health()
