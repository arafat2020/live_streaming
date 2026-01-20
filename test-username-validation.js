// Simple test script to verify unique username validation
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testUniqueUsername() {
  console.log('Testing unique username validation...\n');

  // Test 1: Register first user with username 'testuser'
  try {
    console.log('1. Registering first user with username "testuser"...');
    const response1 = await axios.post(`${BASE_URL}/auth/register`, {
      firstName: 'Test',
      lastName: 'User',
      username: 'testuser',
      email: 'test1@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    });
    console.log('✅ First user registered successfully');
    console.log('User data:', response1.data.data);
  } catch (error) {
    console.log(
      '❌ Failed to register first user:',
      error.response?.data || error.message,
    );
  }

  console.log('\n');

  // Test 2: Try to register second user with same username 'testuser'
  try {
    console.log(
      '2. Attempting to register second user with same username "testuser"...',
    );
    const response2 = await axios.post(`${BASE_URL}/auth/register`, {
      firstName: 'Test',
      lastName: 'User2',
      username: 'testuser',
      email: 'test2@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    });
    console.log('❌ Second user should not have been registered!');
  } catch (error) {
    console.log(
      '✅ Expected error occurred:',
      error.response?.data || error.message,
    );
    if (error.response?.data?.message?.includes('already taken')) {
      console.log('✅ Unique username validation is working correctly!');
    } else {
      console.log(
        '⚠️  Error occurred but might not be the expected username validation error',
      );
    }
  }

  console.log('\n');

  // Test 3: Register user with different username
  try {
    console.log('3. Registering user with different username "testuser2"...');
    const response3 = await axios.post(`${BASE_URL}/auth/register`, {
      firstName: 'Test',
      lastName: 'User3',
      username: 'testuser2',
      email: 'test3@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    });
    console.log('✅ User with different username registered successfully');
  } catch (error) {
    console.log(
      '❌ Failed to register user with different username:',
      error.response?.data || error.message,
    );
  }

  console.log('\nTest completed!');
}

// Wait a bit for server to fully start
setTimeout(() => {
  testUniqueUsername().catch(console.error);
}, 3000);
