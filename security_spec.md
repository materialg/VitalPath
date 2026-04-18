# Firestore Security Specification - MacroFit

## Data Invariants
1. A user can only access their own data path `/users/{userId}/**`.
2. All logs (vitals, meal plans, workouts) must belong to the authenticated user.
3. Timestamps `createdAt` and `updatedAt` (if present) must be server-validated.
4. Food Bank items must have non-negative macro values.

## The Dirty Dozen Payloads (Rejection Tests)
1. **Identity Spoofing**: Attempting to create a profile for another UID.
   - Payload: `SET /users/other_uid { "uid": "other_uid", "email": "evil@example.com" }` as `test_user_uid`.
2. **Profile Escalation**: Attempting to set an `admin` flag on a profile.
   - Payload: `UPDATE /users/my_uid { "isAdmin": true }`
3. **Ghost Fields**: Adding extra fields to a Vital Log.
   - Payload: `CREATE /users/my_uid/vitals/vid { "weight": 180, "date": "...", "ghost": "extra" }`
4. **Invalid Type**: Sending a string for weight.
   - Payload: `CREATE /users/my_uid/vitals/vid { "weight": "heavy", "date": "..." }`
5. **Negative Calories**: Creating a Food Bank item with -500 calories.
   - Payload: `CREATE /users/my_uid/foodBank/fid { "name": "Anti-Food", "calories": -500, ... }`
6. **Large Document Poisoning**: Attempting to write a 1MB string in a meal name.
   - Payload: `CREATE /users/my_uid/mealPlans/pid { "meals": [{ "name": "A" * 1000000, ... }] }`
7. **Unauthorized List**: Querying all users' food banks.
   - Query: `COLLECTION_GROUP foodBank`
8. **Bypassing Verification**: Writing as an account with `email_verified: false` (if strict verification is enabled).
9. **State Shortcutting**: Updating `createdAt` on an existing document.
10. **ID Injection**: Using a 2KB long string as a document ID.
11. **Macro Mismatch**: Total calories not proportional to macros (though strictly rules might only check ranges).
12. **Orphaned Writes**: Creating a workout for a user document that doesn't exist.

## The Test Runner (firestore.rules.test.ts)
*Note: This is a conceptual representation of tests that should be run in a local emulator.*
```typescript
import { assertFails, assertSucceeds, initializeTestApp } from '@firebase/rules-unit-testing';

// Test Identity Spoofing
it('should deny writing to another users profile', async () => {
  const db = initializeTestApp({ auth: { uid: 'user_a' } }).firestore();
  await assertFails(db.doc('users/user_b').set({ email: 'b@example.com' }));
});

// Test Ghost Fields
it('should deny ghost fields in vitals', async () => {
  const db = initializeTestApp({ auth: { uid: 'user_a' } }).firestore();
  await assertFails(db.doc('users/user_a/vitals/v1').set({ 
    weight: 180, 
    date: new Date().toISOString(),
    ghost: 'boo'
  }));
});
```
