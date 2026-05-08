# Java/Spring Patterns Reference

Detailed scanning rules for Java/Spring projects. Referenced by SKILL.md Phase 3.

## Base Package Detection

Strategy: find the deepest common ancestor directory that contains multiple sub-packages.

```bash
# Step 1: Find all source directories (max depth 4 to avoid going too deep)
find {module}/src/main/java {module}/src/main/kotlin -maxdepth 4 -type d 2>/dev/null

# Step 2: Identify base package
# Look for the first directory that has 2+ subdirectories containing .java or .kt files
# Common patterns:
#   com/company/project/         ← base package
#   com/company/project/module/  ← if multi-module within single artifact
```

Heuristics:
- Skip standard prefixes: `com/`, `org/`, `cn/` — these are never the base package
- Base package typically has 3-4 segments: `com.company.project` or `com.company.project.module`
- Confirm by checking: does this directory have multiple sub-packages (controller, service, dao, etc.)?

## Package Classification

Match package directory names (case-insensitive) to layers:

| Keywords | Layer | 中文 |
|----------|-------|------|
| controller, api, rest, endpoint, web | 接口层 | API Layer |
| service, biz, business, application | 业务逻辑层 | Service Layer |
| dao, mapper, repository, persistence | 数据访问层 | Data Access Layer |
| domain, entity, model, po, pojo | 持久化对象 | Domain/Entity |
| dto, vo, request, response, param, query | 数据传输对象 | DTO |
| config, configuration, properties | 配置层 | Configuration |
| common, util, utils, helper, toolkit | 公共工具 | Utilities |
| interceptor, filter, aspect, aop | 切面/拦截器 | Cross-cutting |
| validator, checker, rule | 校验层 | Validation |
| converter, assembler, adapter | 转换层 | Converter |
| enums, constant, constants | 枚举/常量 | Constants |
| event, listener, handler | 事件处理 | Event Handling |
| task, job, schedule | 定时任务 | Scheduled Tasks |
| mq, consumer, producer, message | 消息处理 | Messaging |
| client, feign, rpc | 外部调用 | External Client |

## Architecture Style Detection

```
Has domain/ + application/ + infrastructure/ + interfaces/  → DDD (领域驱动)
Has controller/ + service/ + dao/                           → MVC (经典三层)
Has api/ + biz/ + dal/                                      → 阿里分层
Has adapter/ + port/ + usecase/                             → Hexagonal (六边形)
Otherwise                                                   → Custom (描述实际结构)
```

## Spring Annotation Patterns

### Controller Detection
```bash
grep -rn "@RestController\|@Controller" {module}/src/main/java/
```

### Request Mapping Extraction
```bash
# Class-level base path
grep -B5 "class.*Controller" {file} | grep "@RequestMapping"

# Method-level mappings
grep -n "@\(Get\|Post\|Put\|Delete\|Patch\)Mapping\|@RequestMapping" {file}
```

### Entity Detection
```bash
# JPA entities
grep -rln "@Entity\|@Table" {module}/src/main/java/

# MyBatis-Plus entities
grep -rln "@TableName" {module}/src/main/java/

# MyBatis XML mappers
find {module} -path "*/mapper/*.xml" -o -path "*/mybatis/**/*.xml"
```

### Scheduled Tasks
```bash
grep -rn "@Scheduled" {module}/src/main/java/
# Extract cron: grep the cron attribute value
```

### Event Listeners
```bash
grep -rn "@EventListener\|@TransactionalEventListener\|@KafkaListener\|@RabbitListener\|@RocketMQMessageListener" {module}/src/main/java/
```

### External Service Calls
```bash
# Feign clients
grep -rn "@FeignClient" {module}/src/main/java/
# Extract: name/value (service name), url, path

# Dubbo references
grep -rn "@DubboReference\|@Reference" {module}/src/main/java/
# Extract: interface class, version, group

# REST clients
grep -rn "RestTemplate\|WebClient\|OkHttpClient" {module}/src/main/java/
# Look for URL patterns in surrounding code
```

## Dependency Categories

Parse from `pom.xml` `<dependencies>` or `build.gradle(.kts)` `dependencies {}`:

**Gradle syntax differences — match both when grepping:**
```groovy
// Groovy DSL (build.gradle) — single quotes, no parentheses
implementation 'org.springframework.boot:spring-boot-starter-web'
implementation group: 'org.mybatis', name: 'mybatis', version: '3.5.9'

// Kotlin DSL (build.gradle.kts) — double quotes, parentheses required
implementation("org.springframework.boot:spring-boot-starter-web")
implementation("org.mybatis:mybatis:3.5.9")
```

**Recommended grep pattern (matches both):**
```bash
grep -E "(implementation|api|compileOnly|runtimeOnly|testImplementation)" {module}/build.gradle* 2>/dev/null
```

| groupId / artifact pattern | Category |
|---------------------------|----------|
| org.springframework.boot:spring-boot-starter-* | Framework |
| org.mybatis* / mybatis-plus* | ORM (MyBatis) |
| org.springframework.boot:spring-boot-starter-data-jpa | ORM (JPA) |
| org.springframework.boot:spring-boot-starter-data-redis | Cache |
| org.springframework.kafka* | MQ (Kafka) |
| org.apache.rocketmq* | MQ (RocketMQ) |
| org.springframework.amqp* | MQ (RabbitMQ) |
| mysql:mysql-connector* / com.mysql* | Database (MySQL) |
| org.postgresql* | Database (PostgreSQL) |
| org.springframework.cloud:spring-cloud-starter-openfeign | HTTP Client (Feign) |
| com.squareup.okhttp3* | HTTP Client (OkHttp) |
| io.micrometer* / spring-boot-starter-actuator | Monitoring |
| org.apache.dubbo* | RPC (Dubbo) |
| com.alibaba.cloud:spring-cloud-starter-alibaba-nacos* | Config/Registry (Nacos) |
| com.ctrip.framework.apollo* | Config (Apollo) |

## Build Tool Commands

| Build Tool | Build | Test | Run |
|-----------|-------|------|-----|
| Maven | `mvn clean package -DskipTests` | `mvn test` | `mvn spring-boot:run` |
| Maven Wrapper | `./mvnw clean package -DskipTests` | `./mvnw test` | `./mvnw spring-boot:run` |
| Gradle | `gradle build -x test` | `gradle test` | `gradle bootRun` |
| Gradle Wrapper | `./gradlew build -x test` | `./gradlew test` | `./gradlew bootRun` |

Detection: check for `mvnw`/`gradlew` wrapper scripts first, fall back to bare commands.

## Multi-Module Detection

### Maven
```xml
<!-- root pom.xml -->
<modules>
    <module>module-a</module>
    <module>module-b</module>
</modules>
```

### Gradle
```groovy
// settings.gradle
include 'module-a'
include 'module-b'
// or
include ':module-a', ':module-b'
```

```kotlin
// settings.gradle.kts
include("module-a")
include("module-b")
```

## Inter-Module Dependency Detection

### Maven
```xml
<!-- module-b/pom.xml depends on module-a -->
<dependency>
    <groupId>${project.groupId}</groupId>
    <artifactId>module-a</artifactId>
</dependency>
```

### Gradle
```groovy
// module-b/build.gradle
dependencies {
    implementation project(':module-a')
}
```
