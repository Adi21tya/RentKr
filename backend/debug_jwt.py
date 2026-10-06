
import jwt
import sys

print(f"JWT Module: {jwt}")
print(f"JWT File: {getattr(jwt, '__file__', 'Unknown')}")
print(f"JWT Dir: {dir(jwt)}")

try:
    print(f"jwt.encode exists: {jwt.encode}")
except AttributeError:
    print("jwt.encode DOES NOT exist")

try:
    import jwt.utils
    print("jwt.utils exists (suggests old 'jwt' package)")
except ImportError:
    print("jwt.utils does not exist")
