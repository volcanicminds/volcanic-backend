# Schema Customization: Overriding Core Schemas

`@volcanicminds/backend` relies heavily on Fastify's JSON Schema validation and serialization. The framework provides default schemas for core features like Authentication (Login, Registration), but real-world applications often need to extend these schemas to include custom data fields (e.g., `firstName`, `company`, `roles`).

Instead of modifying the framework source code, you can use the built-in **Schema Overriding** mechanism.

## How It Works

The Schema Loader (`lib/loader/schemas.ts`) follows a specific loading order:

1.  **Load Base Schemas**: Loads schemas from the framework's internal `lib/schemas` directory.
2.  **Load Custom Schemas**: Loads schemas from your application's `src/schemas` directory.
3.  **Deep Merge**: If a Custom Schema shares the same `$id` as a Base Schema, the framework performs a **Smart Deep Merge** using `lodash.defaultsDeep`.

**Rule:** Your custom schema properties take precedence or are added to the base definition.

## Step-by-Step Example: Extending Login Response

Scenario: You want the `/auth/login` endpoint to return the user's `firstName`, `lastName`, and `professional` profile data, in addition to the standard JWT token.

### 1. Identify the Target Schema

Look at the framework documentation or source code to find the `$id` of the schema you want to extend. For login responses, it is `authLoginResponseSchema`.

**Base Schema (Framework):**

```typescript
// lib/schemas/auth.ts
export const authLoginResponseSchema = {
  $id: 'authLoginResponseSchema',
  type: 'object',
  properties: {
    id: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string' },
    token: { type: 'string' }
    // ... other standard fields
  }
}
```

### 2. Create the Override

In your project, create a schema file (e.g., `src/schemas/user.ts`) and define an object with the **exact same `$id`**. Define _only_ the fields you want to add or modify.

**Custom Schema (Application):**

```typescript
// src/schemas/user.ts

// This defines the structure of the Professional entity referenced below
export const professionalSchema = {
  $id: 'professionalSchema',
  type: 'object',
  properties: {
    id: { type: 'string' },
    firstName: { type: 'string' },
    company: { type: 'string' }
  }
}

// This overrides the core authLoginResponseSchema
export const authLoginResponseSchema = {
  $id: 'authLoginResponseSchema',
  type: 'object',
  nullable: true,
  properties: {
    // New fields to inject into the login response
    firstName: { type: 'string' },
    lastName: { type: 'string' },

    // Complex objects can be referenced
    professional: {
      $ref: 'professionalSchema#'
    }
  }
}
```

### 3. Runtime Result

When the server starts, it merges the two definitions. The effective schema used by Fastify for the `/auth/login` route will be:

```javascript
{
  $id: 'authLoginResponseSchema',
  type: 'object',
  properties: {
    id: { type: 'string' },       // From Base
    username: { type: 'string' }, // From Base
    token: { type: 'string' },    // From Base
    firstName: { type: 'string' }, // From Override
    lastName: { type: 'string' },  // From Override
    professional: { $ref: 'professionalSchema#' } // From Override
  }
}
```

## Best Practices

1.  **Keep IDs Unique**: Unless you intend to override, ensure your custom schemas have unique `$id`s.
2.  **Avoid `additionalProperties: true`**: While it allows any data to pass through, it disables Fastify's serialization optimizations and weakens API contracts. Always define your fields explicitly in the override.
3.  **Check Required Fields**: The merge logic attempts to merge `required` arrays. If you add a new field that must be present, add it to the `required` array in your custom schema.
