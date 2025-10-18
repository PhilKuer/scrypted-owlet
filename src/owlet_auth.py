import requests
import json
from typing import Dict, List, Optional, Any
import time

class OwletAuth:
    def __init__(self):
        self.firebase_api_key = 'AIzaSyCx17leGPCKu5tZ1BLPni5LbAAlVvnNxZQ'
        self.firebase_url = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty'
        self.devices_url = 'https://devices-public.owletdata.com/v2'
        self.kms_url = 'https://camera-kms.owletdata.com'
        
        self.jwt_token = None
        self.firebase_refresh_token = None
        self.token_expiry = 0
        self.account_id = None

    async def login(self, email: str, password: str) -> str:
        """Authenticate with Firebase and get JWT token"""
        try:
            print(f"Login attempt - Email: {email}, Password length: {len(str(password))}")
            
            request_data = {
                'email': email,
                'password': password,
                'returnSecureToken': True
            }
            
            print('Firebase request data:', json.dumps({
                'email': request_data['email'],
                'password': f'[{len(request_data["password"])} chars]',
                'returnSecureToken': request_data['returnSecureToken']
            }))
            
            response = requests.post(
                f'{self.firebase_url}/verifyPassword?key={self.firebase_api_key}',
                json=request_data,
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            
            response.raise_for_status()
            data = response.json()
            
            id_token = data['idToken']
            refresh_token = data['refreshToken']
            expires_in = int(data['expiresIn'])
            local_id = data['localId']
            
            self.jwt_token = id_token
            self.firebase_refresh_token = refresh_token
            self.account_id = local_id
            self.token_expiry = time.time() + expires_in

            print('Successfully authenticated with Firebase')
            return id_token

        except requests.exceptions.HTTPError as e:
            print(f'Firebase authentication failed: {e}')
            
            # Handle specific Firebase authentication errors
            if e.response.status_code == 400:
                try:
                    error_data = e.response.json()
                    firebase_error = error_data.get('error', {})
                    error_code = firebase_error.get('code')
                    
                    if error_code == 'auth/user-not-found':
                        raise Exception('Invalid email address. Please check your Owlet account email.')
                    elif error_code == 'auth/wrong-password':
                        raise Exception('Invalid password. Please check your Owlet account password.')
                    elif error_code == 'auth/invalid-email':
                        raise Exception('Invalid email format. Please enter a valid email address.')
                    elif error_code == 'auth/user-disabled':
                        raise Exception('This Owlet account has been disabled. Please contact Owlet support.')
                    elif error_code == 'auth/too-many-requests':
                        raise Exception('Too many failed login attempts. Please try again later.')
                    else:
                        raise Exception(f'Authentication failed: {firebase_error.get("message", "Unknown error")}')
                except json.JSONDecodeError:
                    raise Exception('Authentication failed: Invalid response from server')
            
            raise Exception(f'Authentication failed: {e}')
            
        except requests.exceptions.ConnectionError:
            raise Exception('Network error: Unable to connect to Owlet servers. Please check your internet connection.')
        except requests.exceptions.Timeout:
            raise Exception('Connection timeout: Owlet servers are not responding. Please try again later.')
        except Exception as e:
            raise Exception(f'Authentication failed: {str(e)}')

    async def refresh_token(self, jwt: str) -> str:
        """Refresh JWT token using Firebase refresh token"""
        if not self.firebase_refresh_token:
            raise Exception('No refresh token available')

        try:
            response = requests.post(
                f'{self.firebase_url}/token?key={self.firebase_api_key}',
                json={
                    'grant_type': 'refresh_token',
                    'refresh_token': self.firebase_refresh_token
                },
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            
            response.raise_for_status()
            data = response.json()
            
            id_token = data['id_token']
            refresh_token = data['refresh_token']
            expires_in = int(data['expires_in'])
            
            self.jwt_token = id_token
            self.firebase_refresh_token = refresh_token
            self.token_expiry = time.time() + expires_in

            print('Successfully refreshed JWT token')
            return id_token

        except requests.exceptions.HTTPError as e:
            print(f'Token refresh failed: {e}')
            
            # Handle specific Firebase refresh errors
            if e.response.status_code == 400:
                try:
                    error_data = e.response.json()
                    firebase_error = error_data.get('error', {})
                    error_code = firebase_error.get('code')
                    
                    if error_code == 'auth/invalid-grant':
                        raise Exception('Refresh token expired. Please re-authenticate with your Owlet credentials.')
                    elif error_code == 'auth/token-expired':
                        raise Exception('Authentication token expired. Please re-authenticate.')
                    else:
                        raise Exception(f'Token refresh failed: {firebase_error.get("message", "Unknown error")}')
                except json.JSONDecodeError:
                    raise Exception('Token refresh failed: Invalid response from server')
            
            raise Exception(f'Token refresh failed: {e}')
            
        except requests.exceptions.ConnectionError:
            raise Exception('Network error: Unable to refresh authentication token. Please check your internet connection.')
        except Exception as e:
            raise Exception(f'Token refresh failed: {str(e)}')

    async def get_devices(self, jwt: str, account_id: str) -> List[Dict[str, Any]]:
        """Get list of devices from Owlet API"""
        try:
            # Only try the main devices endpoint to avoid rate limiting
            url = f'{self.devices_url}/accounts/{account_id}/devices'
            
            print('Trying endpoint:', url)
            response = requests.get(
                url,
                headers={
                    'Authorization': f'Bearer {jwt}',
                    'Content-Type': 'application/json'
                },
                timeout=10
            )
            
            response.raise_for_status()
            response_data = response.json()
            
            print(f'Response from {url}:', json.dumps(response_data, indent=2))
            
            # Handle different response structures
            devices = response_data.get('devices') or response_data.get('cameras') or response_data or []
            
            if isinstance(devices, list):
                print(f'Found {len(devices)} devices from {url}')
                
                # Log device types
                for index, device in enumerate(devices):
                    print(f'Device {index}: ID={device.get("id")}, Type={device.get("type")}, Name={device.get("name")}')
                
                # Filter for cameras
                cameras = [device for device in devices if 
                          device.get('type') == 'camera' or 
                          device.get('deviceType') == 'CAMERA' or
                          device.get('id', '').startswith('OCA') or
                          'camera' in device.get('id', '').lower()]
                
                print(f'Found {len(cameras)} cameras from {url}')
                print('Device types:', [f"{d.get('id')}:{d.get('type')}" for d in cameras])

                return cameras

            print('No devices found or invalid response format')
            return []

        except requests.exceptions.HTTPError as e:
            print(f'Failed to get devices: {e}')
            
            # Handle specific HTTP status codes
            if e.response.status_code == 401:
                raise Exception('Authentication expired. Please check your Owlet credentials and try again.')
            elif e.response.status_code == 403:
                raise Exception('Access denied. Your Owlet account may not have permission to access cameras.')
            elif e.response.status_code == 404:
                raise Exception('Owlet API endpoint not found. The service may be temporarily unavailable.')
            elif e.response.status_code >= 500:
                raise Exception('Owlet servers are experiencing issues. Please try again later.')
            
            raise Exception(f'Failed to get devices: {e}')
            
        except requests.exceptions.ConnectionError:
            raise Exception('Network error: Unable to connect to Owlet servers. Please check your internet connection.')
        except requests.exceptions.Timeout:
            raise Exception('Connection timeout: Owlet servers are not responding. Please try again later.')
        except Exception as e:
            raise Exception(f'Failed to get devices: {str(e)}')

    async def get_tutk_credentials(self, jwt: str, device_id: str) -> Dict[str, str]:
        """Get TUTK credentials for camera streaming"""
        try:
            response = requests.get(
                f'{self.kms_url}/kms/{device_id}',
                headers={
                    'Authorization': jwt,  # Note: NOT Bearer, just raw token
                    'Content-Type': 'application/json'
                },
                timeout=10
            )
            
            response.raise_for_status()
            return response.json()

        except requests.exceptions.HTTPError as e:
            print(f'Failed to get TUTK credentials for device {device_id}: {e}')
            
            # Handle specific HTTP status codes
            if e.response.status_code == 401:
                raise Exception('Authentication expired. Please check your Owlet credentials and try again.')
            elif e.response.status_code == 403:
                raise Exception('Access denied. Your Owlet account may not have permission to access this camera.')
            elif e.response.status_code == 404:
                raise Exception(f'Camera {device_id} not found. The camera may be offline or removed from your account.')
            elif e.response.status_code >= 500:
                raise Exception('Owlet servers are experiencing issues. Please try again later.')
            
            raise Exception(f'Failed to get TUTK credentials for camera {device_id}: {e}')
            
        except requests.exceptions.ConnectionError:
            raise Exception('Network error: Unable to connect to Owlet servers. Please check your internet connection.')
        except requests.exceptions.Timeout:
            raise Exception('Connection timeout: Owlet servers are not responding. Please try again later.')
        except Exception as e:
            raise Exception(f'Failed to get TUTK credentials for camera {device_id}: {str(e)}')

    def _is_token_valid(self) -> bool:
        """Check if current token is valid"""
        if not self.jwt_token:
            return False
        
        # Check if token expires within the next 5 minutes
        five_minutes_from_now = time.time() + (5 * 60)
        return time.time() < self.token_expiry and self.token_expiry > five_minutes_from_now

    async def ensure_valid_token(self) -> str:
        """Ensure we have a valid token, refresh if needed"""
        if not self._is_token_valid():
            print('JWT token expired or invalid, attempting refresh...')
            try:
                if self.firebase_refresh_token:
                    return await self.refresh_token(self.jwt_token or '')
                else:
                    raise Exception('No refresh token available')
            except Exception as e:
                print(f'Token refresh failed: {e}')
                raise Exception('Authentication expired. Please re-authenticate with your Owlet credentials.')
        
        return self.jwt_token

    def is_authenticated(self) -> bool:
        """Check if currently authenticated"""
        return self._is_token_valid()

    def logout(self):
        """Clear authentication state"""
        self.jwt_token = None
        self.firebase_refresh_token = None
        self.token_expiry = 0
        self.account_id = None

    # Getters for current state
    def get_current_jwt(self) -> Optional[str]:
        """Get current JWT token"""
        return self.jwt_token

    def get_account_id(self) -> Optional[str]:
        """Get current account ID"""
        return self.account_id

    # Legacy methods for backward compatibility
    async def authenticate(self, username: str, password: str):
        """Legacy method for backward compatibility"""
        await self.login(username, password)

    async def get_devices_legacy(self) -> List[Dict[str, Any]]:
        """Legacy method for backward compatibility"""
        if not self.jwt_token or not self.account_id:
            raise Exception('Not authenticated')
        return await self.get_devices(self.jwt_token, self.account_id)

    async def get_camera_connection_info(self, device_id: str) -> Optional[Dict[str, Any]]:
        """Legacy method for backward compatibility"""
        if not self.jwt_token:
            raise Exception('Not authenticated')

        try:
            tutk_credentials = await self.get_tutk_credentials(self.jwt_token, device_id)
            
            # Convert TUTK credentials to legacy format
            return {
                'uid': tutk_credentials['tutkid'],
                'password': tutk_credentials['password'],
                'ipAddress': '',  # Not available from KMS
                'port': 0,  # Not available from KMS
                'deviceId': device_id,
                'status': 'online'
            }
        except Exception as e:
            print(f'Failed to get connection info for device {device_id}: {e}')
            return None
