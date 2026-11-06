'use strict';

const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'public', 'verify-email.html');

const content = fs.readFileSync(pagePath, 'utf8');

// Check loading state
if (!content.includes('Verifying your email...')) {
  console.error('FAIL: Loading state text "Verifying your email..." not found');
  process.exit(1);
}
if (!content.includes('Please wait while we confirm your account.')) {
  console.error('FAIL: Loading message "Please wait while we confirm your account." not found');
  process.exit(1);
}
if (!content.includes('spinner')) {
  console.error('FAIL: Spinner element not found');
  process.exit(1);
}
if (!content.includes('Email verified successfully!')) {
  console.error('FAIL: Success state text "Email verified successfully!" not found');
  process.exit(1);
}
if (!content.includes('Verification failed')) {
  console.error('FAIL: Error state text "Verification failed" not found');
  process.exit(1);
}
if (!content.includes('Sign in to Tableverse')) {
  console.error('FAIL: Sign-in button text "Sign in to Tableverse" not found');
  process.exit(1);
}
if (!content.includes('Back to Home')) {
  console.error('FAIL: Back to Home button text not found');
  process.exit(1);
}
if (!content.includes('hidden')) {
  console.error('FAIL: Hidden state classes not found');
  process.exit(1);
}

// Check structure
const container = content.indexOf('<div id="verifyApp" class="verify-container">');
if (container === -1) {
  console.error('FAIL: Main container "verifyApp" not found');
  process.exit(1);
}

const loading = content.indexOf('<div id="verifyLoading">');
const success = content.indexOf('<div id="verifySuccess" hidden>');
const error = content.indexOf('<div id="verifyError" hidden>');

if (loading === -1) {
  console.error('FAIL: Loading container "verifyLoading" not found');
  process.exit(1);
}
if (success === -1) {
  console.error('FAIL: Success container "verifySuccess" not found');
  process.exit(1);
}
if (error === -1) {
  console.error('FAIL: Error container "verifyError" not found');
  process.exit(1);
}

console.log('All verify-email-frontend tests passed');