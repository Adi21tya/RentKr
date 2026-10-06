#!/usr/bin/env python3
"""
RentKr Backend Authentication Testing Suite
Tests the complete authentication flow for the RentKr application
"""

import requests
import json
import time
import uuid
from datetime import datetime

# Configuration
BACKEND_URL = "https://login-fix-161.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

class AuthTester:
    def __init__(self):
        self.session = requests.Session()
        self.test_results = []
        self.jwt_token = None
        self.test_user_email = None
        self.test_user_password = "TestPassword123!"
        
    def log_result(self, test_name, success, details, response_data=None):
        """Log test result"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat(),
            "response_data": response_data
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {details}")
        if response_data and not success:
            print(f"   Response: {json.dumps(response_data, indent=2)}")
    
    def test_database_connectivity(self):
        """Test MongoDB connection via health endpoint"""
        try:
            response = self.session.get(f"{API_BASE}/health/db", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") and data.get("db"):
                    self.log_result(
                        "Database Connectivity", 
                        True, 
                        f"MongoDB connected successfully to database: {data.get('db')}", 
                        data
                    )
                    return True
                else:
                    self.log_result(
                        "Database Connectivity", 
                        False, 
                        "Health endpoint returned invalid response", 
                        data
                    )
                    return False
            else:
                self.log_result(
                    "Database Connectivity", 
                    False, 
                    f"Health check failed with status {response.status_code}", 
                    {"status_code": response.status_code, "text": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Database Connectivity", 
                False, 
                f"Connection error: {str(e)}"
            )
            return False
    
    def test_user_registration_tenant(self):
        """Test tenant user registration with valid data"""
        timestamp = int(time.time())
        email = f"test_tenant_{timestamp}@example.com"
        
        user_data = {
            "email": email,
            "password": self.test_user_password,
            "name": "Test Tenant User",
            "user_type": "tenant",
            "phone": "+91-9876543210"
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/auth/register",
                json=user_data,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                # Verify response structure
                required_fields = ["user_id", "email", "name", "user_type", "created_at"]
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    self.log_result(
                        "Tenant Registration", 
                        False, 
                        f"Missing required fields: {missing_fields}", 
                        data
                    )
                    return False
                
                # Verify password is not returned
                if "password" in data or "password_hash" in data:
                    self.log_result(
                        "Tenant Registration", 
                        False, 
                        "Password field returned in response (security issue)", 
                        data
                    )
                    return False
                
                # Verify user type
                if data.get("user_type") != "tenant":
                    self.log_result(
                        "Tenant Registration", 
                        False, 
                        f"Incorrect user_type: expected 'tenant', got '{data.get('user_type')}'", 
                        data
                    )
                    return False
                
                self.test_user_email = email  # Store for login test
                self.log_result(
                    "Tenant Registration", 
                    True, 
                    f"Tenant registered successfully with user_id: {data.get('user_id')}", 
                    data
                )
                return True
            else:
                self.log_result(
                    "Tenant Registration", 
                    False, 
                    f"Registration failed with status {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Tenant Registration", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_user_registration_landlord(self):
        """Test landlord user registration with valid data"""
        timestamp = int(time.time())
        email = f"test_landlord_{timestamp}@example.com"
        
        user_data = {
            "email": email,
            "password": self.test_user_password,
            "name": "Test Landlord User",
            "user_type": "landlord",
            "phone": "+91-9876543211"
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/auth/register",
                json=user_data,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Verify user type
                if data.get("user_type") != "landlord":
                    self.log_result(
                        "Landlord Registration", 
                        False, 
                        f"Incorrect user_type: expected 'landlord', got '{data.get('user_type')}'", 
                        data
                    )
                    return False
                
                self.log_result(
                    "Landlord Registration", 
                    True, 
                    f"Landlord registered successfully with user_id: {data.get('user_id')}", 
                    data
                )
                return True
            else:
                self.log_result(
                    "Landlord Registration", 
                    False, 
                    f"Registration failed with status {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Landlord Registration", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_duplicate_email_registration(self):
        """Test registration with duplicate email (should fail with 400)"""
        if not self.test_user_email:
            self.log_result(
                "Duplicate Email Registration", 
                False, 
                "No test user email available from previous registration test"
            )
            return False
        
        user_data = {
            "email": self.test_user_email,
            "password": "AnotherPassword123!",
            "name": "Another User",
            "user_type": "tenant"
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/auth/register",
                json=user_data,
                timeout=10
            )
            
            if response.status_code == 400:
                data = response.json()
                if "already registered" in data.get("detail", "").lower():
                    self.log_result(
                        "Duplicate Email Registration", 
                        True, 
                        "Correctly rejected duplicate email with 400 status", 
                        data
                    )
                    return True
                else:
                    self.log_result(
                        "Duplicate Email Registration", 
                        False, 
                        f"Got 400 status but unexpected error message: {data.get('detail')}", 
                        data
                    )
                    return False
            else:
                self.log_result(
                    "Duplicate Email Registration", 
                    False, 
                    f"Expected 400 status, got {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Duplicate Email Registration", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_invalid_email_registration(self):
        """Test registration with invalid email format"""
        user_data = {
            "email": "invalid-email-format",
            "password": self.test_user_password,
            "name": "Test User",
            "user_type": "tenant"
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/auth/register",
                json=user_data,
                timeout=10
            )
            
            if response.status_code == 422:  # Pydantic validation error
                self.log_result(
                    "Invalid Email Registration", 
                    True, 
                    "Correctly rejected invalid email format with 422 status", 
                    {"status_code": response.status_code}
                )
                return True
            else:
                self.log_result(
                    "Invalid Email Registration", 
                    False, 
                    f"Expected 422 status for invalid email, got {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Invalid Email Registration", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_missing_fields_registration(self):
        """Test registration with missing required fields"""
        user_data = {
            "email": "test@example.com",
            # Missing password, name, user_type
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/auth/register",
                json=user_data,
                timeout=10
            )
            
            if response.status_code == 422:  # Pydantic validation error
                self.log_result(
                    "Missing Fields Registration", 
                    True, 
                    "Correctly rejected missing required fields with 422 status", 
                    {"status_code": response.status_code}
                )
                return True
            else:
                self.log_result(
                    "Missing Fields Registration", 
                    False, 
                    f"Expected 422 status for missing fields, got {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Missing Fields Registration", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_valid_login(self):
        """Test login with valid credentials"""
        if not self.test_user_email:
            self.log_result(
                "Valid Login", 
                False, 
                "No test user email available from registration test"
            )
            return False
        
        login_data = {
            "email": self.test_user_email,
            "password": self.test_user_password
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/auth/login",
                json=login_data,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Verify response structure
                if "token" not in data or "user" not in data:
                    self.log_result(
                        "Valid Login", 
                        False, 
                        "Missing 'token' or 'user' in login response", 
                        data
                    )
                    return False
                
                # Verify JWT token format (should be 3 parts separated by dots)
                token = data.get("token")
                if not token or len(token.split('.')) != 3:
                    self.log_result(
                        "Valid Login", 
                        False, 
                        "Invalid JWT token format", 
                        {"token_parts": len(token.split('.')) if token else 0}
                    )
                    return False
                
                # Verify user data
                user_data = data.get("user", {})
                required_user_fields = ["user_id", "email", "name", "user_type"]
                missing_fields = [field for field in required_user_fields if field not in user_data]
                
                if missing_fields:
                    self.log_result(
                        "Valid Login", 
                        False, 
                        f"Missing user fields: {missing_fields}", 
                        data
                    )
                    return False
                
                # Store token for subsequent tests
                self.jwt_token = token
                
                self.log_result(
                    "Valid Login", 
                    True, 
                    f"Login successful for user: {user_data.get('email')}", 
                    {"user_id": user_data.get("user_id"), "user_type": user_data.get("user_type")}
                )
                return True
            else:
                self.log_result(
                    "Valid Login", 
                    False, 
                    f"Login failed with status {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Valid Login", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_invalid_password_login(self):
        """Test login with invalid password (should return 401)"""
        if not self.test_user_email:
            self.log_result(
                "Invalid Password Login", 
                False, 
                "No test user email available from registration test"
            )
            return False
        
        login_data = {
            "email": self.test_user_email,
            "password": "WrongPassword123!"
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/auth/login",
                json=login_data,
                timeout=10
            )
            
            if response.status_code == 401:
                data = response.json()
                if "invalid credentials" in data.get("detail", "").lower():
                    self.log_result(
                        "Invalid Password Login", 
                        True, 
                        "Correctly rejected invalid password with 401 status", 
                        data
                    )
                    return True
                else:
                    self.log_result(
                        "Invalid Password Login", 
                        False, 
                        f"Got 401 but unexpected error message: {data.get('detail')}", 
                        data
                    )
                    return False
            else:
                self.log_result(
                    "Invalid Password Login", 
                    False, 
                    f"Expected 401 status, got {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Invalid Password Login", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_nonexistent_email_login(self):
        """Test login with non-existent email (should return 401)"""
        login_data = {
            "email": f"nonexistent_{int(time.time())}@example.com",
            "password": self.test_user_password
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/auth/login",
                json=login_data,
                timeout=10
            )
            
            if response.status_code == 401:
                data = response.json()
                if "invalid credentials" in data.get("detail", "").lower():
                    self.log_result(
                        "Nonexistent Email Login", 
                        True, 
                        "Correctly rejected nonexistent email with 401 status", 
                        data
                    )
                    return True
                else:
                    self.log_result(
                        "Nonexistent Email Login", 
                        False, 
                        f"Got 401 but unexpected error message: {data.get('detail')}", 
                        data
                    )
                    return False
            else:
                self.log_result(
                    "Nonexistent Email Login", 
                    False, 
                    f"Expected 401 status, got {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Nonexistent Email Login", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_missing_fields_login(self):
        """Test login with missing fields"""
        login_data = {
            "email": "test@example.com"
            # Missing password
        }
        
        try:
            response = self.session.post(
                f"{API_BASE}/auth/login",
                json=login_data,
                timeout=10
            )
            
            if response.status_code == 422:  # Pydantic validation error
                self.log_result(
                    "Missing Fields Login", 
                    True, 
                    "Correctly rejected missing password field with 422 status", 
                    {"status_code": response.status_code}
                )
                return True
            else:
                self.log_result(
                    "Missing Fields Login", 
                    False, 
                    f"Expected 422 status for missing password, got {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Missing Fields Login", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_get_current_user_valid_token(self):
        """Test /auth/me with valid JWT token"""
        if not self.jwt_token:
            self.log_result(
                "Get Current User (Valid Token)", 
                False, 
                "No JWT token available from login test"
            )
            return False
        
        headers = {
            "Authorization": f"Bearer {self.jwt_token}"
        }
        
        try:
            response = self.session.get(
                f"{API_BASE}/auth/me",
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Verify response structure
                required_fields = ["user_id", "email", "name", "user_type"]
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    self.log_result(
                        "Get Current User (Valid Token)", 
                        False, 
                        f"Missing required fields: {missing_fields}", 
                        data
                    )
                    return False
                
                # Verify email matches our test user
                if data.get("email") != self.test_user_email:
                    self.log_result(
                        "Get Current User (Valid Token)", 
                        False, 
                        f"Email mismatch: expected {self.test_user_email}, got {data.get('email')}", 
                        data
                    )
                    return False
                
                self.log_result(
                    "Get Current User (Valid Token)", 
                    True, 
                    f"Successfully retrieved user data for: {data.get('email')}", 
                    {"user_id": data.get("user_id"), "user_type": data.get("user_type")}
                )
                return True
            else:
                self.log_result(
                    "Get Current User (Valid Token)", 
                    False, 
                    f"Request failed with status {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Get Current User (Valid Token)", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_get_current_user_invalid_token(self):
        """Test /auth/me with invalid token (should return 401)"""
        headers = {
            "Authorization": "Bearer invalid.jwt.token"
        }
        
        try:
            response = self.session.get(
                f"{API_BASE}/auth/me",
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 401:
                data = response.json()
                self.log_result(
                    "Get Current User (Invalid Token)", 
                    True, 
                    "Correctly rejected invalid token with 401 status", 
                    data
                )
                return True
            else:
                self.log_result(
                    "Get Current User (Invalid Token)", 
                    False, 
                    f"Expected 401 status, got {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Get Current User (Invalid Token)", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def test_get_current_user_no_token(self):
        """Test /auth/me without token (should return 401)"""
        try:
            response = self.session.get(
                f"{API_BASE}/auth/me",
                timeout=10
            )
            
            if response.status_code == 401:
                data = response.json()
                self.log_result(
                    "Get Current User (No Token)", 
                    True, 
                    "Correctly rejected request without token with 401 status", 
                    data
                )
                return True
            else:
                self.log_result(
                    "Get Current User (No Token)", 
                    False, 
                    f"Expected 401 status, got {response.status_code}", 
                    {"status_code": response.status_code, "response": response.text}
                )
                return False
                
        except Exception as e:
            self.log_result(
                "Get Current User (No Token)", 
                False, 
                f"Request error: {str(e)}"
            )
            return False
    
    def run_all_tests(self):
        """Run all authentication tests"""
        print("=" * 80)
        print("RentKr Backend Authentication Testing Suite")
        print("=" * 80)
        print(f"Backend URL: {BACKEND_URL}")
        print(f"API Base: {API_BASE}")
        print("=" * 80)
        
        # Test order is important - some tests depend on previous ones
        tests = [
            self.test_database_connectivity,
            self.test_user_registration_tenant,
            self.test_user_registration_landlord,
            self.test_duplicate_email_registration,
            self.test_invalid_email_registration,
            self.test_missing_fields_registration,
            self.test_valid_login,
            self.test_invalid_password_login,
            self.test_nonexistent_email_login,
            self.test_missing_fields_login,
            self.test_get_current_user_valid_token,
            self.test_get_current_user_invalid_token,
            self.test_get_current_user_no_token,
        ]
        
        passed = 0
        failed = 0
        
        for test in tests:
            try:
                if test():
                    passed += 1
                else:
                    failed += 1
            except Exception as e:
                print(f"❌ FAIL {test.__name__}: Unexpected error: {str(e)}")
                failed += 1
            
            # Small delay between tests
            time.sleep(0.5)
        
        print("=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print(f"Total Tests: {passed + failed}")
        print(f"Passed: {passed}")
        print(f"Failed: {failed}")
        print(f"Success Rate: {(passed / (passed + failed) * 100):.1f}%")
        
        if failed > 0:
            print("\nFAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"  - {result['test']}: {result['details']}")
        
        return passed, failed, self.test_results

if __name__ == "__main__":
    tester = AuthTester()
    passed, failed, results = tester.run_all_tests()
    
    # Exit with error code if any tests failed
    exit(0 if failed == 0 else 1)