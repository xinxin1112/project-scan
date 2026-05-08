# Frontend Vue Patterns Reference

Detailed scanning rules for Vue 2/3 projects. Referenced by SKILL.md Phase 11-15.

## Route Parsing (Vue Router)

### Locating Route Files

```bash
find {frontend-path}/src -name "router*" -o -name "routes*" | grep -E "\.(ts|js)$"
```

Common locations:
- `src/router/index.ts` — main router config
- `src/router/routes.ts` — route definitions (separated)
- `src/router/modules/*.ts` — modular route files

### Route Structure Patterns

**Standard array format:**
```typescript
const routes: RouteRecordRaw[] = [
  {
    path: '/user',
    component: Layout,
    children: [
      { path: 'list', component: () => import('@/views/user/UserList.vue'), name: 'UserList', meta: { title: '用户列表', permission: 'user:list' } },
      { path: ':id', component: () => import('@/views/user/UserDetail.vue'), name: 'UserDetail' }
    ]
  }
]
```

**Modular import format:**
```typescript
// router/index.ts
import userRoutes from './modules/user'
import orderRoutes from './modules/order'
const routes = [...userRoutes, ...orderRoutes]
```

### Parsing Rules

1. **Nested expansion:** Recursively expand `children`, concatenate parent path + child path
   - `/user` + `list` → `/user/list`
   - `/user` + `:id` → `/user/:id`
2. **Layout skip:** If a route node has `children` but its component is `Layout`/`BasicLayout`/`BlankLayout` → skip this node in output, only output its children with full path
3. **Dynamic params:** Preserve as-is: `:id`, `:userId`, `[id]`
4. **Lazy import extraction:** `() => import('@/views/user/UserList.vue')` → extract `views/user/UserList.vue`
5. **Meta extraction:** Extract `title`, `permission`/`roles`, `hidden`/`visible` from `meta` object

### Output Format

| 路由 | 页面组件 | 权限 | 业务说明 |
|------|----------|------|----------|
| /user/list | views/user/UserList.vue | user:list | — |
| /user/:id | views/user/UserDetail.vue | — | — |

## API Layer Patterns

### Locating API Files

```bash
find {frontend-path}/src -path "*/api/*" -o -path "*/services/*" -o -path "*/request/*" | grep -E "\.(ts|js)$"
```

### Common Patterns

**Pattern 1 — Exported functions (most common):**
```typescript
// api/user.ts
import request from '@/utils/request'

export function getUserList(params: PageQuery): Promise<PageResult<User>> {
  return request.get('/user/list', { params })
}

export function createUser(data: CreateUserReq): Promise<User> {
  return request.post('/user', data)
}
```

Extraction: function name, HTTP method (from `request.get/post/put/delete`), URL path (first argument), param type, return type.

**Pattern 2 — Class-based service:**
```typescript
class UserService {
  getUserList(params: PageQuery) {
    return request.get<PageResult<User>>('/user/list', { params })
  }
}
export default new UserService()
```

Extraction: class name + method name, HTTP method, URL path, types.

**Pattern 3 — Object literal export:**
```typescript
export const userApi = {
  list: (params: PageQuery) => request.get('/user/list', { params }),
  create: (data: CreateUserReq) => request.post('/user', data),
}
```

Extraction: object name + key, HTTP method, URL path.

**Pattern 4 — Auto-generated (swagger-codegen / openapi-generator):**

Indicators:
- File header contains `auto-generated`, `swagger`, `openapi-generator`
- File path contains `generated` or `__generated__`

Action: Record generation source only, don't copy full content. Note in output:
```
类型来源: auto-generated from swagger (src/api/types/generated.ts)
```

### Axios Instance Detection

```bash
grep -rn "axios.create\|baseURL" {frontend-path}/src/utils/ {frontend-path}/src/plugins/
```

Extract `baseURL` value — often from env variable:
```typescript
const service = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL  // → check .env files
})
```

### Call Relationship Tracking

For each exported API function, find which components import it:
```bash
grep -rln "import.*{functionName}\|from.*api/user" {frontend-path}/src/views/ {frontend-path}/src/pages/
```

## State Management — Pinia

### Locating Store Files

```bash
find {frontend-path}/src -path "*/stores/*" -o -path "*/store/*" | grep -E "\.(ts|js)$"
```

### Extraction Pattern

```typescript
export const useUserStore = defineStore('user', {
  state: () => ({
    userList: [] as User[],
    currentUser: null as User | null,
    loading: false,
  }),
  actions: {
    async fetchUsers() { ... },
    async updateUser(id: string, data: Partial<User>) { ... },
  }
})
```

Extract: store name (`user`), state fields + types, action names.

**Setup store syntax (Composition API):**
```typescript
export const useUserStore = defineStore('user', () => {
  const userList = ref<User[]>([])
  const fetchUsers = async () => { ... }
  return { userList, fetchUsers }
})
```

## State Management — Vuex

### Extraction Pattern

```typescript
export default {
  namespaced: true,
  state: { userList: [], loading: false },
  mutations: { SET_USER_LIST(state, list) { ... } },
  actions: { fetchUsers({ commit }) { ... } }
}
```

Extract: module name (from file name or `namespaced`), state fields, mutation names, action names.

## Component Scanning

### Reference Count

```bash
# For each component file name (e.g., SearchForm.vue)
grep -rln "SearchForm\|search-form" {frontend-path}/src/views/ | wc -l
```

Note: Vue supports both PascalCase (`<SearchForm>`) and kebab-case (`<search-form>`) in templates.
