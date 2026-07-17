# ClosetOS

ClosetOS is a GitHub-native wardrobe assistant that helps a user decide what to wear, track clothing usage, manage laundry status, plan packing lists, and improve recommendations over time.

The user interacts with ClosetOS through WhatsApp. Messages and photos are forwarded to GitHub Agentic Workflows, where specialized agents process the request, read the wardrobe data, generate a response, and store new feedback.

The main goal is not only to recommend outfits, but to build a system that learns from real behavior. ClosetOS should gradually understand which clothes the user actually wears, which combinations work well, which items are uncomfortable, which outfits fit certain weather conditions, and which recommendations the user tends to reject.

---

## 1. Project Goals

ClosetOS should:

- Recommend outfits based on occasion, weather, comfort, availability, and past feedback.
- Track clothing items and their current status.
- Accept natural-language commands through WhatsApp.
- Support clothing-photo intake.
- Record outfit ratings and user comments.
- Generate packing lists for trips.
- Identify underused, difficult-to-style, or unnecessary clothing.
- Learn preferences from repeated behavior.
- Turn recommendation failures into evaluation cases.
- Propose agent improvements through reviewable GitHub pull requests.

---

## 2. Example User Experience

The user sends a WhatsApp message:

> What should I wear to the office today? It is warm and I want something comfortable.

ClosetOS replies:

> Best overall: grey knit polo, black relaxed trousers, and white sneakers.  
> Comfort-first: white T-shirt, navy trousers, and grey sneakers.  
> Slightly experimental: striped Oxford shirt, black trousers, and loafers.

After wearing the outfit, the user sends:

> I wore the first one. 8/10. The polo was still a little warm.

ClosetOS stores the result and may learn a rule such as:

> Avoid recommending the grey knit polo above 78°F unless the user specifically requests it.

The user can also send commands such as:

```text
/outfit office, comfortable, warm weather
/dirty black trousers
/clean latest laundry load
/rate 8, shoes hurt after walking
/pack New York, five days, work and casual
/add-item
```

Natural-language interaction can be added later:

> My black pants and grey polo are dirty.

---

## 3. High-Level Architecture

```text
User
  |
  | WhatsApp message or image
  v
WhatsApp Cloud API
  |
  | HTTPS webhook
  v
AWS Lambda Function URL or API Gateway
  |
  | Validate, parse, and route
  v
GitHub API
  |
  | workflow_dispatch
  v
GitHub Agentic Workflows
  |
  | Read wardrobe data
  | Generate recommendation
  | Record feedback
  | Create reports or pull requests
  v
Result Callback
  |
  v
AWS Lambda
  |
  | WhatsApp Messages API
  v
User
```

The architecture has three main layers:

1. **WhatsApp interface**  
   The user sends messages and photos.

2. **AWS bridge**  
   A lightweight backend receives WhatsApp webhooks and triggers GitHub workflows.

3. **GitHub intelligence layer**  
   GitHub Agentic Workflows run the agents, store wardrobe knowledge, evaluate results, and propose improvements.

---

## 4. Why AWS Is Used

AWS is not the main intelligence of ClosetOS. It is the communication bridge between WhatsApp and GitHub.

WhatsApp needs a public HTTPS endpoint where Meta can deliver incoming messages. GitHub workflows do not directly provide a suitable public webhook endpoint for WhatsApp, so a small backend is needed.

### AWS Lambda

AWS Lambda runs the bridge code.

Its responsibilities include:

- Receiving incoming WhatsApp webhook events.
- Verifying webhook signatures.
- Checking that the sender is authorized.
- Extracting message text, media metadata, and message IDs.
- Determining which GitHub workflow should run.
- Calling the GitHub API.
- Receiving workflow results.
- Sending responses back through the WhatsApp API.
- Preventing duplicate message processing.

### Lambda Function URL

For the simplest MVP, a Lambda Function URL can expose the Lambda directly over HTTPS.

```text
WhatsApp
   |
   v
Lambda Function URL
   |
   v
GitHub workflow_dispatch
```

This avoids the need for API Gateway during the first version.

### API Gateway

API Gateway can be introduced later when the project needs:

- More advanced routing.
- Request throttling.
- Separate webhook and callback endpoints.
- Detailed monitoring.
- Custom domains.
- More control over authorization and request transformation.

### Optional AWS Services

#### DynamoDB

DynamoDB can store temporary or rapidly changing state, such as:

- Pending WhatsApp requests.
- Conversation state.
- Processed message IDs.
- GitHub workflow run IDs.
- Current laundry status.
- Temporary user sessions.

DynamoDB is optional for the MVP.

#### S3

S3 can store clothing photos before the GitHub workflow processes them.

Example flow:

```text
WhatsApp image
    |
    v
Lambda downloads image
    |
    v
S3 object
    |
    v
GitHub workflow receives temporary image URL or object reference
```

S3 is useful because binary images should not be passed directly as workflow inputs.

#### Secrets Manager or Parameter Store

These services can store:

- WhatsApp access tokens.
- Meta app secrets.
- GitHub App private keys.
- Callback secrets.

For a small MVP, Lambda environment variables may be sufficient, but a dedicated secrets service is safer.

#### CloudWatch

CloudWatch provides:

- Lambda logs.
- Error tracking.
- Invocation metrics.
- Debugging information.
- Alerts for failed webhook handling.

---

## 5. Do We Need a Database?

A database is not required for the first version.

ClosetOS can initially store its durable data as YAML or JSON files inside the GitHub repository.

### GitHub-Only Storage

Example:

```text
wardrobe/
  items/
  availability.yaml

outfits/
  history/

preferences/
  explicit.yaml
  learned.yaml

evaluations/
  availability.yaml
  weather-fit.yaml
  diversity.yaml

reports/
  weekly/
  monthly/
```

Advantages:

- No separate database setup.
- Full Git history.
- Easy to inspect manually.
- Agents can directly read the files.
- Every learned rule is auditable.
- Strong GitHub-native portfolio story.

Disadvantages:

- Frequent updates create commits or pull requests.
- Concurrent workflow runs may cause merge conflicts.
- Real-time chat state is harder to manage.
- Large histories become inefficient to query.

### Recommended MVP Approach

Use GitHub files for:

- Clothing inventory.
- Outfit history.
- User ratings.
- Learned preferences.
- Evaluation cases.
- Agent prompts.
- Weekly reports.

Avoid a database until the project needs:

- Multi-message conversations.
- Multiple users.
- Fast real-time state changes.
- Large outfit histories.
- High workflow concurrency.
- A mobile or web dashboard.
- Reliable pending-request tracking.

### Recommended Long-Term Hybrid Approach

Use DynamoDB for operational state:

```text
Pending WhatsApp requests
Processed message IDs
Conversation state
Workflow run IDs
Laundry availability
Temporary item status
```

Use GitHub for durable knowledge:

```text
Wardrobe definitions
Confirmed outfit history
Learned style rules
Evaluations
Prompt versions
Agent improvement proposals
Weekly reports
```

This creates a useful distinction:

```text
DynamoDB = fast operational state
GitHub = auditable long-term intelligence
```

---

## 6. Main Agents

### 6.1 Coordinator Agent

The coordinator receives the WhatsApp message and decides which specialist should handle it.

Possible intents:

```text
outfit_request
outfit_feedback
new_item
laundry_update
packing_request
closet_audit
general_question
```

Example parsed request:

```json
{
  "intent": "outfit_feedback",
  "items": [
    "grey-knit-polo-01",
    "black-trousers-01"
  ],
  "rating": 8,
  "feedback": [
    "polo was too warm"
  ]
}
```

For the MVP, explicit commands can be routed by Lambda before reaching the agent.

### 6.2 Closet Intake Agent

Adds new clothing items.

Inputs may include:

- A WhatsApp image.
- A name.
- Brand.
- Category.
- Color.
- Fit.
- Formality.
- Season.
- Notes.

Example item:

```yaml
id: shirt-blue-oxford-01
name: Blue striped Oxford shirt
brand: Ralph Lauren
category: top
subcategory: button-down
colors:
  - blue
  - white
pattern: striped
fit: regular
formality:
  - smart-casual
  - business-casual
seasons:
  - spring
  - summer
  - fall
status: available
```

### 6.3 Outfit Recommendation Agent

Generates outfit options using:

- Occasion.
- Weather.
- Dress code.
- Current item availability.
- Recent outfits.
- Historical ratings.
- Comfort feedback.
- Learned preferences.
- Rotation goals.
- Desired experimentation level.

Recommended output:

1. Best overall.
2. Comfort-first.
3. Slightly experimental.

Hard constraints:

- Do not recommend dirty items.
- Do not recommend items needing repair.
- Do not recommend packed or unavailable items.
- Respect the dress code.
- Respect required and avoided items.
- Avoid repeating an identical recent outfit.

### 6.4 Outfit Review Agent

Processes feedback after an outfit is worn.

Example user input:

> 8/10. Looked good, but the shoes hurt after walking.

Structured result:

```yaml
outfit_id: outfit-2026-07-17-01
overall_rating: 8
appearance_rating: 8
comfort_rating: 6
weather_fit: 8
would_wear_again: true
observations:
  - white sneakers are uncomfortable for long walking
```

### 6.5 Rotation Agent

Finds items that are not being worn.

It should distinguish among:

- Forgotten items.
- Wrong-season items.
- Hard-to-style items.
- Poor-fit items.
- Disliked items.
- Items needing repair.
- Potential donation candidates.

### 6.6 Laundry Agent

Tracks whether clothing is:

```text
available
dirty
in-laundry
needs-repair
packed
loaned-out
stored
```

Example commands:

```text
/dirty grey polo and black trousers
/clean all
/repair white sneakers
```

### 6.7 Packing Agent

Generates a travel capsule wardrobe based on:

- Destination.
- Weather.
- Trip length.
- Purpose.
- Laundry access.
- Baggage constraints.
- Planned events.
- Previous packing feedback.

After the trip, the user can report:

```text
Unused:
- Second pair of jeans

Forgot:
- Light jacket

Needed more:
- Socks
```

The next packing list should adapt.

### 6.8 Closet Audit Agent

Produces insights such as:

- Items that have not been worn recently.
- Frequently repeated outfits.
- Wardrobe gaps.
- Duplicate items.
- High-performing core pieces.
- Poor cost-per-wear purchases.
- Clothes that are consistently uncomfortable.

---

## 7. Self-Improvement System

ClosetOS should not silently rewrite its own instructions.

Instead, it should use a controlled improvement loop:

```text
User request
    |
    v
Agent recommendation
    |
    v
User outcome and rating
    |
    v
Evaluator
    |
    v
New observation or failure case
    |
    v
Proposed rule or prompt change
    |
    v
Regression evaluation
    |
    v
GitHub pull request
    |
    v
Human review and merge
```

### Learned Preferences

Example:

```yaml
weather:
  avoid_grey_knit_polo_above_f: 78

comfort:
  white_sneakers:
    avoid_when_walking_minutes_above: 45

style:
  preferred_office_bottoms:
    - black-trousers-01
    - navy-trousers-01
```

### Failure-to-Evaluation Loop

Failure:

> The agent recommended white sneakers even though they were marked dirty.

New evaluation:

```yaml
name: unavailable-item-check
context:
  dirty_items:
    - shoes-white-01
request:
  occasion: office
expected:
  must_not_include:
    - shoes-white-01
```

Another failure:

> The agent recommended nearly identical outfits four days in a row.

New evaluation:

```yaml
name: recent-outfit-diversity
expected:
  maximum_recent_item_overlap: 0.75
```

### Prompt Improvement Pull Request

A weekly learning workflow might open a PR:

```text
Title:
Improve warm-weather office recommendations

Evidence:
- Grey knit polo received poor weather-fit ratings on four of five days above 78°F.
- Lightweight shirts averaged 1.7 points higher.

Proposed change:
Avoid recommending the grey knit polo above 78°F unless explicitly requested.

Regression results:
- Availability checks: passed
- Dress-code checks: passed
- Historical recommendation quality: improved
```

---

## 8. GitHub Workflow Design

Suggested workflows:

```text
.github/workflows/
  whatsapp-router.md
  closet-intake.md
  outfit-request.md
  outfit-review.md
  laundry-update.md
  packing-assistant.md
  weekly-rotation.md
  closet-audit.md
  weekly-learning.md
  prompt-improvement.md
```

### Workflow Dispatch Inputs

Example:

```yaml
on:
  workflow_dispatch:
    inputs:
      request_id:
        required: true
        type: string
      user_message:
        required: true
        type: string
      sender_id:
        required: true
        type: string
      media_url:
        required: false
        type: string
      callback_url:
        required: true
        type: string
```

### Recommended Trigger Strategy

Use `workflow_dispatch` for the MVP.

The Lambda determines which workflow to trigger:

```text
/outfit    -> outfit-request workflow
/rate      -> outfit-review workflow
/add-item  -> closet-intake workflow
/dirty     -> laundry-update workflow
/pack      -> packing-assistant workflow
```

Later, a single coordinator workflow can receive all natural-language messages.

---

## 9. Returning Results to WhatsApp

GitHub workflows are asynchronous and may take time to start.

The bridge should immediately acknowledge the request:

> Looking through your closet now.

When the workflow finishes, it should call a protected callback endpoint.

```text
GitHub workflow
    |
    | POST /workflow-result
    v
Lambda
    |
    | WhatsApp Messages API
    v
User
```

Example callback payload:

```json
{
  "request_id": "req-123",
  "status": "completed",
  "response": "Best overall: grey polo, black trousers, and white sneakers."
}
```

The callback endpoint should require a shared secret or signed request.

---

## 10. Suggested Repository Structure

```text
closetos/
├── .github/
│   └── workflows/
│       ├── whatsapp-router.md
│       ├── closet-intake.md
│       ├── outfit-request.md
│       ├── outfit-review.md
│       ├── laundry-update.md
│       ├── packing-assistant.md
│       ├── weekly-rotation.md
│       └── prompt-improvement.md
│
├── wardrobe/
│   ├── tops/
│   ├── bottoms/
│   ├── shoes/
│   ├── outerwear/
│   ├── accessories/
│   └── availability.yaml
│
├── outfits/
│   ├── recommendations/
│   └── outcomes/
│
├── preferences/
│   ├── explicit.yaml
│   ├── learned.yaml
│   └── style-rules.md
│
├── evaluations/
│   ├── availability.yaml
│   ├── weather-fit.yaml
│   ├── diversity.yaml
│   └── packing.yaml
│
├── reports/
│   ├── weekly/
│   └── monthly/
│
├── prompts/
│   ├── coordinator.md
│   ├── outfit-agent.md
│   ├── review-agent.md
│   └── learning-agent.md
│
├── infrastructure/
│   ├── lambda/
│   ├── terraform/
│   └── architecture.md
│
└── README.md
```

---

## 11. Security

ClosetOS will process private wardrobe information and WhatsApp messages, so security should be part of the initial design.

### Required Controls

- Verify Meta webhook signatures.
- Allow messages only from approved phone numbers.
- Use a private GitHub repository.
- Use a GitHub App instead of a broad personal access token.
- Store credentials outside the repository.
- Use GitHub Actions secrets.
- Use AWS Secrets Manager or Parameter Store for production.
- Restrict GitHub workflow permissions.
- Restrict which files agents may modify.
- Use pull requests for prompt and preference changes.
- Add rate limits to prevent unexpected workflow costs.
- Deduplicate WhatsApp message IDs.
- Avoid storing raw phone numbers when a hashed identifier is sufficient.
- Use short-lived URLs for clothing photos.
- Avoid submitting photos containing faces or identifiable backgrounds when possible.

### Important Secrets

```text
WHATSAPP_ACCESS_TOKEN
WHATSAPP_VERIFY_TOKEN
META_APP_SECRET
GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY
GITHUB_INSTALLATION_ID
CALLBACK_SHARED_SECRET
```

---

## 12. MVP Scope

The MVP should avoid unnecessary complexity.

### Phase 1: GitHub-Only Prototype

Build:

- Manual clothing inventory.
- Outfit request workflow.
- Laundry status tracking.
- Outfit feedback workflow.
- Weekly rotation report.
- Learned-preference file.
- Basic evaluation cases.

Interface:

- GitHub issues or manual workflow dispatch.

### Phase 2: WhatsApp Integration

Add:

- WhatsApp Cloud API.
- Lambda Function URL.
- Sender allowlist.
- Command routing.
- GitHub workflow dispatch.
- Callback response to WhatsApp.
- Duplicate-message protection.

Supported commands:

```text
/outfit
/dirty
/clean
/rate
/pack
```

### Phase 3: Photo Intake and Better Learning

Add:

- Clothing photos.
- S3 temporary storage.
- Computer-vision-assisted item tagging.
- Natural-language intent routing.
- Weekly prompt improvement PRs.
- Automatically generated regression evaluations.

### Phase 4: Hybrid Data and Multi-User Support

Add:

- DynamoDB.
- Conversation state.
- Multiple users.
- User authentication.
- Web dashboard.
- Analytics.
- Faster operational updates.

---

## 13. Initial Data Model

### Clothing Item

```yaml
id: pants-black-uniqlo-01
name: Black relaxed trousers
brand: Uniqlo
category: bottoms
subcategory: trousers
colors:
  - black
fit: relaxed
formality:
  - casual
  - smart-casual
  - business-casual
seasons:
  - spring
  - summer
  - fall
status: available
wear_count: 12
last_worn: 2026-07-15
purchase_price: 49.90
notes: Comfortable for office days
```

### Outfit Outcome

```yaml
id: outfit-2026-07-17-01
date: 2026-07-17
occasion: office
temperature_f: 82
items:
  - grey-knit-polo-01
  - pants-black-uniqlo-01
  - shoes-white-01
ratings:
  overall: 8
  appearance: 8
  comfort: 7
  weather_fit: 6
would_wear_again: true
feedback:
  - polo was slightly too warm
```

### Pending Request

This can initially be passed through workflow inputs. Later, it can be stored in DynamoDB.

```json
{
  "request_id": "req-123",
  "message_id": "wamid-456",
  "sender_id": "user-01",
  "intent": "outfit_request",
  "status": "running",
  "workflow_run_id": "789",
  "created_at": "2026-07-17T15:30:00Z"
}
```

---

## 14. Outfit Scoring

A simple recommendation score can combine:

```text
25% historical outfit rating
20% occasion match
15% weather match
15% predicted comfort
10% style compatibility
10% rotation bonus
 5% novelty
```

Hard constraints should be applied before scoring:

```text
Item must be available
Item must not need repair
Outfit must satisfy dress code
Required items must be included
Avoided items must be excluded
Recent exact outfits should not be repeated
```

The scoring weights may later be adjusted based on user behavior.

---

## 15. Portfolio Value

ClosetOS demonstrates:

- GitHub Agentic Workflows.
- Multi-agent orchestration.
- WhatsApp integration.
- Serverless infrastructure.
- Event-driven architecture.
- Structured agent memory.
- Human feedback loops.
- Evaluation-driven improvement.
- Safe agent self-improvement.
- GitHub App authentication.
- Infrastructure as code.
- Real-world personalization.
- A practical daily-use product.

The strongest project framing is:

> ClosetOS is a GitHub-native wardrobe assistant that uses WhatsApp as its conversational interface and GitHub Agentic Workflows as its reasoning, memory, evaluation, and self-improvement layer. User feedback is converted into structured preferences, regression tests, and reviewable pull requests so the system becomes more useful over time without making uncontrolled changes to itself.
