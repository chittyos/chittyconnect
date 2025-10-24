# ChittyConnect Test Suite

Comprehensive test suite for ChittyConnect using Vitest and Cloudflare Workers testing tools.

## Test Structure

```
tests/
├── unit/                    # Unit tests (fast, mocked dependencies)
│   ├── ecosystem.test.js    # ChittyOS ecosystem integration tests
│   ├── contexts.test.js     # Contexts API tests
│   └── ...                  # Other unit tests
├── integration/             # Integration tests (full worker environment)
│   ├── worker.test.js       # Complete worker flow tests
│   └── ...                  # Other integration tests
├── helpers/                 # Test utilities and mocks
│   └── mock-chittyos.js     # ChittyOS service mocks
└── README.md               # This file
```

---

## Running Tests

### All Tests

```bash
npm test
```

### Unit Tests Only

```bash
npm run test:unit
```

Fast tests with mocked dependencies. Ideal for TDD and rapid development.

### Integration Tests Only

```bash
npm run test:integration
```

Full Cloudflare Workers environment tests with Miniflare.

### Watch Mode

```bash
npm run test:watch
```

Runs tests in watch mode, re-running on file changes.

### Coverage Report

```bash
npm run test:coverage
```

Generates coverage report in `coverage/` directory.

View HTML report:
```bash
open coverage/index.html
```

---

## Writing Tests

### Unit Test Example

**File**: `tests/unit/my-module.test.js`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { myFunction } from '../../src/my-module.js';
import { createMockEnv, createMockContext } from '../helpers/mock-chittyos.js';

describe('myFunction', () => {
  let env, ctx;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockContext();
  });

  it('should do something', async () => {
    const result = await myFunction('input', env, ctx);

    expect(result).toBe('expected-output');
  });

  it('should handle errors', async () => {
    await expect(myFunction(null, env, ctx)).rejects.toThrow('Invalid input');
  });
});
```

### Integration Test Example

**File**: `tests/integration/my-flow.test.js`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../src/index.js';
import { createMockEnv, createMockContext } from '../helpers/mock-chittyos.js';

describe('My Flow Integration', () => {
  let env, ctx;

  beforeEach(() => {
    env = createMockEnv();
    ctx = createMockContext();
  });

  it('should handle complete request flow', async () => {
    const request = new Request('https://test.com/v1/my-endpoint', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: 'test' }),
    });

    const response = await worker.fetch(request, env, ctx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });
});
```

---

## Test Helpers

### Mock Environment

```javascript
import { createMockEnv } from '../helpers/mock-chittyos.js';

const env = createMockEnv({
  // Override defaults
  ENVIRONMENT: 'custom-test',
  CUSTOM_VAR: 'value',
});
```

Includes mocked:
- Environment variables
- ChittyOS service URLs
- Service tokens
- D1 database
- KV namespaces
- Queues

### Mock Execution Context

```javascript
import { createMockContext } from '../helpers/mock-chittyos.js';

const ctx = createMockContext();

// Use waitUntil
ctx.waitUntil(somePromise);

// Check promises added
const promises = ctx.getPromises();
expect(promises.length).toBe(1);
```

### Mock ChittyOS Services

```javascript
import { createMockFetch, mockChittyID } from '../helpers/mock-chittyos.js';

// Default mocks (all services return success)
global.fetch = createMockFetch();

// Custom responses
global.fetch = createMockFetch({
  mintChittyID: mockChittyID.mintSuccess('CONTEXT', { name: 'Test' }),
  validateActor: mockChittyAuth.validateActorSuccess('CHITTY-ACTOR-123'),
});

// Mock specific service failure
global.fetch = createMockFetch({
  mintChittyID: mockChittyID.mintFailure('Service unavailable'),
});
```

### Mock Database (D1)

```javascript
import { createMockDB } from '../helpers/mock-chittyos.js';

const db = createMockDB();

// Mock specific query response
env.DB.prepare = vi.fn((sql) => ({
  bind: vi.fn(() => ({
    first: vi.fn(async () => ({
      chitty_id: 'CHITTY-CONTEXT-123',
      name: 'Test Context',
    })),
    all: vi.fn(async () => ({ results: [...] })),
    run: vi.fn(async () => ({ success: true })),
  })),
}));
```

### Mock KV Namespace

```javascript
import { createMockKV } from '../helpers/mock-chittyos.js';

const kv = createMockKV();

// Use like real KV
await kv.put('key', 'value');
const value = await kv.get('key');
expect(value).toBe('value');
```

### Mock Queue

```javascript
import { createMockQueue } from '../helpers/mock-chittyos.js';

const queue = createMockQueue();

// Send messages
await queue.send({ operation: 'test' });

// Verify messages
const messages = queue.getMessages();
expect(messages.length).toBe(1);
expect(messages[0].body.operation).toBe('test');

// Clear for next test
queue.clear();
```

---

## Coverage Requirements

Target coverage thresholds:

```yaml
Lines: 80%
Functions: 80%
Branches: 75%
Statements: 80%
```

### Coverage Exclusions

- `node_modules/`
- `tests/`
- `**/*.test.js`
- `**/*.spec.js`
- `scripts/`
- `migrations/`

---

## Best Practices

### 1. Test Isolation

Each test should be independent:

```javascript
beforeEach(() => {
  // Fresh mocks for each test
  env = createMockEnv();
  ctx = createMockContext();
  global.fetch = createMockFetch();
});
```

### 2. Descriptive Test Names

```javascript
// ✅ Good
it('should return 401 when authorization header is missing', async () => {});

// ❌ Bad
it('should work', async () => {});
```

### 3. Arrange-Act-Assert Pattern

```javascript
it('should create context with valid input', async () => {
  // Arrange
  const request = new Request(url, { method: 'POST', body: data });

  // Act
  const response = await createContext(request, env, ctx);

  // Assert
  expect(response.status).toBe(201);
});
```

### 4. Test Both Success and Failure Cases

```javascript
describe('createContext', () => {
  it('should succeed with valid input', async () => {
    // Test happy path
  });

  it('should fail with missing name', async () => {
    // Test validation error
  });

  it('should fail without authorization', async () => {
    // Test auth error
  });
});
```

### 5. Mock External Services

Always mock ChittyOS services - never call real services in tests:

```javascript
// ✅ Good
global.fetch = createMockFetch();

// ❌ Bad
// Calling real ChittyID service
```

### 6. Test Side Effects

```javascript
it('should send message to queue', async () => {
  await createContext(request, env, ctx);

  const messages = env.CONTEXT_OPS_QUEUE.getMessages();
  expect(messages.length).toBe(1);
  expect(messages[0].body.operation).toBe('context_created');
});
```

### 7. Use Spies for Verification

```javascript
it('should call ChittyID mint endpoint', async () => {
  const fetchSpy = vi.spyOn(global, 'fetch');

  await ecosystem.mintChittyID('CONTEXT', {});

  const idCalls = fetchSpy.mock.calls.filter(call =>
    call[0].includes('id.chitty') && call[0].includes('/v1/mint')
  );

  expect(idCalls.length).toBeGreaterThan(0);
});
```

---

## Debugging Tests

### Run Single Test File

```bash
npm test tests/unit/ecosystem.test.js
```

### Run Single Test

```bash
npm test -- -t "should create context"
```

### Verbose Output

```bash
npm test -- --reporter=verbose
```

### Debug with Chrome DevTools

```bash
npm test -- --inspect-brk
```

Then open Chrome and navigate to `chrome://inspect`

---

## CI Integration

Tests run automatically in GitHub Actions CI workflow (`.github/workflows/ci.yml`):

```yaml
- name: Run unit tests
  run: npm test

- name: Upload coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
```

---

## Common Issues

### Issue: "Cannot find module"

**Solution**: Check import paths use correct relative paths:
```javascript
// ✅ Correct
import { foo } from '../../src/foo.js';

// ❌ Wrong
import { foo } from 'src/foo.js';
```

### Issue: "fetch is not defined"

**Solution**: Ensure mock fetch is set in `beforeEach`:
```javascript
beforeEach(() => {
  global.fetch = createMockFetch();
});
```

### Issue: "Test timeout"

**Solution**: Increase timeout or check for unresolved promises:
```javascript
it('should work', async () => {
  // ...
}, 10000); // 10 second timeout
```

### Issue: "Cannot read property of undefined"

**Solution**: Mock environment properly:
```javascript
beforeEach(() => {
  env = createMockEnv(); // Don't forget this!
});
```

---

## Adding New Tests

### For New API Endpoint

1. Create unit test in `tests/unit/`:
   ```javascript
   // tests/unit/my-endpoint.test.js
   import { myEndpointHandler } from '../../src/api/my-endpoint.js';

   describe('myEndpointHandler', () => {
     // Write tests
   });
   ```

2. Add integration test in `tests/integration/`:
   ```javascript
   // tests/integration/my-flow.test.js
   describe('My Endpoint Flow', () => {
     it('should handle complete request', async () => {
       const response = await worker.fetch(request, env, ctx);
       // Assert response
     });
   });
   ```

### For New ChittyOS Service Integration

1. Add mock to `tests/helpers/mock-chittyos.js`:
   ```javascript
   export const mockNewService = {
     operationSuccess: () => ({ success: true, data: {} }),
     operationFailure: () => ({ success: false, error: 'Failed' }),
   };
   ```

2. Add to `createMockFetch`:
   ```javascript
   if (urlStr.includes('newservice.chitty')) {
     return new Response(JSON.stringify(responses.newOperation || mockNewService.operationSuccess()));
   }
   ```

3. Write tests using the mock

---

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Cloudflare Workers Testing](https://developers.cloudflare.com/workers/testing/)
- [Miniflare Documentation](https://miniflare.dev/)
- [ChittyConnect CI/CD Guide](../docs/deployment/CI_CD_GUIDE.md)

---

**Test Coverage Target**: 80%+
**Test Suite Size**: ~50+ tests
**Last Updated**: 2025-10-24
