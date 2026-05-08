# Frontend React Patterns Reference

Detailed scanning rules for React projects. Referenced by SKILL.md Phase 11-15.

## Route Parsing (React Router)

### Locating Route Files

```bash
grep -rln "Route\|createBrowserRouter\|useRoutes" {frontend-path}/src/ | head -20
```

Common locations:
- `src/router/index.tsx` — centralized route config
- `src/App.tsx` — inline route definitions
- `src/routes.tsx` — separated route array

### Route Structure Patterns

**React Router v6 — createBrowserRouter:**
```typescript
const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: 'user', element: <UserList /> },
      { path: 'user/:id', element: <UserDetail /> },
    ]
  }
])
```

**React Router v6 — useRoutes:**
```typescript
const routes: RouteObject[] = [
  {
    path: '/user',
    element: <Layout />,
    children: [
      { index: true, element: <UserList /> },
      { path: ':id', element: <UserDetail /> },
    ]
  }
]
```

**React Router v6 — JSX Route:**
```tsx
<Routes>
  <Route path="/" element={<Layout />}>
    <Route path="user" element={<UserList />} />
    <Route path="user/:id" element={<UserDetail />} />
  </Route>
</Routes>
```

### Parsing Rules

1. **Nested expansion:** Same as Vue — concatenate parent + child paths
2. **Layout skip:** If element is `Layout`/`AppLayout`/`MainLayout` → skip node, output children
3. **Index routes:** `{ index: true }` → use parent path
4. **Dynamic params:** `:id`, `:userId` — preserve as-is
5. **Lazy loading:** `React.lazy(() => import('./pages/User'))` → extract component path
6. **Auth wrapper:** If wrapped in `<ProtectedRoute>`/`<AuthGuard>` → note as "requires auth"

### Next.js App Router (Convention-based)

```bash
find {frontend-path}/app -name "page.tsx" -o -name "page.ts" | sort
```

Directory structure → routes:
- `app/page.tsx` → `/`
- `app/user/page.tsx` → `/user`
- `app/user/[id]/page.tsx` → `/user/:id`
- `app/(admin)/dashboard/page.tsx` → `/dashboard` (group ignored)

**Layout detection:**
- `app/layout.tsx` → root layout
- `app/user/layout.tsx` → nested layout for `/user/*`

**Route groups:** `(groupName)` directories are organizational only, not in URL.

### Next.js Pages Router

```bash
find {frontend-path}/pages -name "*.tsx" -o -name "*.ts" | grep -v "_app\|_document\|api/" | sort
```

File path → route:
- `pages/index.tsx` → `/`
- `pages/user/index.tsx` → `/user`
- `pages/user/[id].tsx` → `/user/:id`

## API Layer Patterns

### Locating API Files

```bash
find {frontend-path}/src -path "*/api/*" -o -path "*/services/*" -o -path "*/hooks/use*Query*" -o -path "*/hooks/use*Mutation*" | grep -E "\.(ts|tsx|js)$"
```

### Common Patterns

**Pattern 1 — Exported functions (same as Vue):**
```typescript
// api/user.ts
import { request } from '@/utils/request'

export const getUserList = (params: PageQuery): Promise<PageResult<User>> =>
  request.get('/user/list', { params })

export const createUser = (data: CreateUserReq): Promise<User> =>
  request.post('/user', data)
```

**Pattern 2 — React Query / TanStack Query hooks:**
```typescript
// hooks/useUsers.ts
export function useUsers(params: PageQuery) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => request.get<PageResult<User>>('/user/list', { params }),
  })
}

export function useCreateUser() {
  return useMutation({
    mutationFn: (data: CreateUserReq) => request.post<User>('/user', data),
  })
}
```

Extraction: hook name, HTTP method (from queryFn/mutationFn), URL path, types.

**Pattern 3 — RTK Query (Redux Toolkit Query):**
```typescript
export const userApi = createApi({
  reducerPath: 'userApi',
  endpoints: (builder) => ({
    getUserList: builder.query<PageResult<User>, PageQuery>({
      query: (params) => ({ url: '/user/list', params }),
    }),
    createUser: builder.mutation<User, CreateUserReq>({
      query: (data) => ({ url: '/user', method: 'POST', body: data }),
    }),
  }),
})
```

Extraction: endpoint name, method (query=GET, mutation=POST by default, or explicit), URL, types.

**Pattern 4 — fetch/axios wrapper:**
```typescript
export async function getUserList(params: PageQuery): Promise<PageResult<User>> {
  const res = await fetch(`/api/user/list?${new URLSearchParams(params)}`)
  return res.json()
}
```

### Call Relationship Tracking

```bash
# For exported functions
grep -rln "import.*getUserList\|from.*api/user" {frontend-path}/src/ | grep -E "(pages|views|components)/"

# For React Query hooks
grep -rln "useUsers\|useCreateUser" {frontend-path}/src/ | grep -E "(pages|views|components)/"
```

## State Management — Redux Toolkit

### Locating Store Files

```bash
find {frontend-path}/src -path "*/store*" -o -path "*/slices/*" -o -path "*/features/*/slice*" | grep -E "\.(ts|js)$"
```

### Extraction Pattern

```typescript
// store/slices/userSlice.ts
const userSlice = createSlice({
  name: 'user',
  initialState: {
    users: [] as User[],
    loading: false,
    error: null as string | null,
  },
  reducers: {
    setUsers: (state, action: PayloadAction<User[]>) => { state.users = action.payload },
    clearUsers: (state) => { state.users = [] },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchUsers.fulfilled, (state, action) => { ... })
  }
})
```

Extract: slice name, initialState fields + types, reducer names, async thunk names.

## State Management — Zustand

### Extraction Pattern

```typescript
// store/useUserStore.ts
export const useUserStore = create<UserState>((set) => ({
  users: [],
  loading: false,
  fetchUsers: async () => {
    set({ loading: true })
    const users = await getUserList()
    set({ users, loading: false })
  },
}))
```

Extract: store name, state fields, action names.

## Component Scanning

### Reference Count

```bash
# For each component (e.g., DataTable)
grep -rln "<DataTable\|DataTable" {frontend-path}/src/pages/ {frontend-path}/src/views/ | wc -l
```

Note: React components are always PascalCase in JSX.
