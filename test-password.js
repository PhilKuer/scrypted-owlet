#!/usr/bin/env node

/**
 * Test script to verify password handling with special characters
 * This simulates how Scrypted would handle the password field
 */

const testPassword = "TestPass123!";

console.log('Testing password handling with special characters...');
console.log(`Original password: "${testPassword}"`);
console.log(`Password length: ${testPassword.length}`);
console.log(`First char: '${testPassword.charAt(0)}'`);
console.log(`Last char: '${testPassword.charAt(testPassword.length - 1)}'`);

// Test different conversion methods
console.log('\n--- Testing conversion methods ---');

console.log('String(value):', String(testPassword));
console.log('value.toString():', testPassword.toString());
console.log('JSON.stringify(value):', JSON.stringify(testPassword));

// Test character codes
console.log('\n--- Character codes ---');
for (let i = 0; i < testPassword.length; i++) {
    const char = testPassword.charAt(i);
    console.log(`Char ${i}: '${char}' (code: ${char.charCodeAt(0)})`);
}

// Test Firebase request simulation
console.log('\n--- Firebase request simulation ---');
const requestData = {
    email: "test@example.com",
    password: testPassword,
    returnSecureToken: true
};

console.log('Request data:', JSON.stringify({
    email: requestData.email,
    password: `[${requestData.password.length} chars]`,
    returnSecureToken: requestData.returnSecureToken
}));

console.log('\n--- Expected behavior ---');
console.log('Password should be stored and retrieved exactly as: "TestPass123!"');
console.log('Length should be 12 characters');
console.log('Last character should be "!" (code 33)');
