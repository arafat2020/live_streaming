const axios = require('axios');

const BASE_URL = 'http://localhost:8000';

async function test() {
  try {
    console.log('Testing registration with unique username...');

    const userData = {
      firstName: 'Test',
      lastName: 'User',
      username: 'uniqueuser123',
      email: 'testunique@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    };

    console.log('Sending request to:', `${BASE_URL}/auth/register`);
    console.log('User data:', JSON.stringify(userData, null, 2));

    const response = await axios.post(`${BASE_URL}/auth/register`, userData);
    console.log('✅ Success:', response.data);
  } catch (error) {
    console.log('❌ Error details:');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', JSON.stringify(error.response.data, null, 2));
      console.log('Headers:', error.response.headers);
    } else if (error.request) {
      console.log('No response received:', error.message);
    } else {
      console.log('Request setup error:', error.message);
    }
  }
}

test();
