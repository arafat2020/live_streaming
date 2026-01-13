# Admin Ban API - Client Integration Guide

This guide describes how to call the administrative ban endpoints from your client application (e.g., React, Vue, or Next.js) using `axios`.

## Base Configuration

All requests to the `/admin` routes require a valid JWT token with **ADMIN** privileges in the headers.

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.VITE_API_URL || 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add interceptor to include token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

---

## 1. Search Users to Ban
**Endpoint:** `GET /admin/ban/search?q={query}`
Search for users by email, name, or ID.

```javascript
const searchUsers = async (query) => {
  try {
    const { data } = await api.get(`/admin/ban/search?q=${query}`);
    return data;
  } catch (error) {
    console.error('Search failed:', error.response?.data?.message || error.message);
  }
};
```

## 2. Issue a Ban (Permanent or Temporary)
**Endpoint:** `POST /admin/ban/:userId`
Apply a ban to a specific user.

```javascript
const banUser = async (userId, banData) => {
  /**
   * banData example:
   * {
   *   banType: 'PERMANENT' | 'TEMPORARY',
   *   durationInDays: 7, // Required if TEMPORARY
   *   reason: 'Violated terms of service'
   * }
   */
  try {
    const { data } = await api.post(`/admin/ban/${userId}`, banData);
    return data;
  } catch (error) {
    console.error('Ban failed:', error.response?.data?.message || error.message);
  }
};
```

## 3. Manually Unban a User
**Endpoint:** `POST /admin/ban/:userId/unban`
Remove a ban from a user.

```javascript
const unbanUser = async (userId) => {
  try {
    const { data } = await api.post(`/admin/ban/${userId}/unban`);
    return data;
  } catch (error) {
    console.error('Unban failed:', error.response?.data?.message || error.message);
  }
};
```

## 4. Retrieve All Currently Banned Users
**Endpoint:** `GET /admin/ban/list`
Fetch a list of all users who are currently banned.

```javascript
const getBannedUsers = async () => {
  try {
    const { data } = await api.get('/admin/ban/list');
    return data;
  } catch (error) {
    console.error('Failed to fetch banned users:', error.response?.data?.message || error.message);
  }
};
```

---

## Error Handling
The server will return standard HTTP status codes:
- `401 Unauthorized`: Token is missing or invalid.
- `403 Forbidden`: User does not have `ADMIN` role.
- `404 Not Found`: User ID does not exist.
- `400 Bad Request`: Missing `durationInDays` for `TEMPORARY` ban.
