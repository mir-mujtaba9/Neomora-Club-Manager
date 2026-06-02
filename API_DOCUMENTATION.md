# Neomora Club Manager API Documentation

**Base URL**: `http://localhost:3000/api/v1`

## Authentication

Most endpoints require a Bearer Token in the `Authorization` header:
`Authorization: Bearer <your_access_token>`

---

## 1. Auth Module
Handles administrative and staff authentication.

### Login
- **URL**: `/auth/login`
- **Method**: `POST`
- **Authentication**: Public
- **Body**:
  ```json
  {
    "tenantSlug": "string",
    "email": "user@example.com",
    "password": "password123"
  }
  ```

### Refresh Token
- **URL**: `/auth/refresh`
- **Method**: `POST`
- **Authentication**: Public
- **Body**:
  ```json
  {
    "refreshToken": "string"
  }
  ```

### Get My Profile
- **URL**: `/auth/me`
- **Method**: `GET`
- **Authentication**: Required (JWT)

### Logout
- **URL**: `/auth/logout`
- **Method**: `POST`
- **Authentication**: Required (JWT)
- **Body**:
  ```json
  {
    "refreshToken": "string"
  }
  ```

### Switch Tenant
- **URL**: `/auth/switch-tenant`
- **Method**: `POST`
- **Authentication**: Required (JWT + SUPER_ADMIN)
- **Body**:
  ```json
  {
    "tenantId": "uuid",
    "tenantSlug": "string"
  }
  ```

---

## 2. Guardian Auth Module
Handles magic-link authentication for participants and guardians.

### Request Magic Link
- **URL**: `/guardian-auth/request-link`
- **Method**: `POST`
- **Authentication**: Public
- **Body**:
  ```json
  {
    "tenantSlug": "string",
    "email": "guardian@example.com",
    "phone": "string (optional)"
  }
  ```

### Verify Magic Link
- **URL**: `/guardian-auth/verify`
- **Method**: `POST`
- **Authentication**: Public
- **Body**:
  ```json
  {
    "token": "magic-link-token"
  }
  ```

### Get Guardian Profile
- **URL**: `/guardian-auth/me`
- **Method**: `GET`
- **Authentication**: Required (JWT - Guardian only)

---

## 3. Users Module
Manage staff and administrative users.

### Create User
- **URL**: `/users`
- **Method**: `POST`
- **Authentication**: Required (JWT + SUPER_ADMIN)
- **Body**:
  ```json
  {
    "name": "string (optional)",
    "email": "user@example.com",
    "password": "min-8-chars",
    "role": "SUPER_ADMIN | LOCATION_MANAGER | STAFF | TRAINER"
  }
  ```

### List Users
- **URL**: `/users`
- **Method**: `GET`
- **Authentication**: Required (JWT + SUPER_ADMIN)
- **Query Params**:
  - `role`: Filter by role
  - `locationId`: Filter by location
  - `page`: Default 1
  - `limit`: Default 20

### Get User by ID
- **URL**: `/users/:id`
- **Method**: `GET`
- **Authentication**: Required (JWT + SUPER_ADMIN)

### Update User
- **URL**: `/users/:id`
- **Method**: `PATCH`
- **Authentication**: Required (JWT + SUPER_ADMIN)
- **Body**:
  ```json
  {
    "role": "string (optional)",
    "locationId": "uuid (optional)"
  }
  ```

### Delete User
- **URL**: `/users/:id`
- **Method**: `DELETE`
- **Authentication**: Required (JWT + SUPER_ADMIN)

---

## 4. Locations Module
Manage club branches and facilities.

### Create Location
- **URL**: `/locations`
- **Method**: `POST`
- **Authentication**: Required (JWT + SUPER_ADMIN)
- **Body**:
  ```json
  {
    "name": "string",
    "city": "string",
    "address": "string (optional)",
    "phone": "string (optional)",
    "capacity": 50
  }
  ```

### List Locations
- **URL**: `/locations`
- **Method**: `GET`
- **Authentication**: Required (JWT)
- **Query Params**:
  - `status`: "active" | "inactive" | "maintenance"
  - `city`: string
  - `page`: Default 1
  - `limit`: Default 20

### Update Location
- **URL**: `/locations/:id`
- **Method**: `PATCH`
- **Authentication**: Required (JWT + SUPER_ADMIN or LOCATION_MANAGER)
- **Body**:
  ```json
  {
    "name": "string",
    "address": "string",
    "city": "string",
    "phone": "string",
    "email": "string",
    "capacity": 0,
    "status": "active"
  }
  ```

### Get Registration Config
- **URL**: `/locations/:slug/register`
- **Method**: `GET`
- **Authentication**: Public
- **Description**: Returns configuration for public registration page based on location slug.
