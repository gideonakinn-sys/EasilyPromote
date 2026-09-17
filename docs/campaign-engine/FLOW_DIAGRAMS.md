# EasilyPromote Campaign Engine — Flow Diagrams

This document illustrates the end-to-end architecture, lifecycle gates, rate routing, and applicant evaluation flows.

---

## 1. Complete Campaign Lifecycle (Dual-Gate Architecture)

The critical architectural rule: **Creator Approval** (permission to participate) and **Content Approval** (review of created content) are two completely separate gates.

```mermaid
flowchart TD
    subgraph Discovery["Phase 1: Discovery & Gating"]
        A[Creator Browses Marketplace] --> B{Access Model?}
        
        %% Open Call Path
        B -->|Open Call| C[Creator clicks JOIN CAMPAIGN]
        C --> D{Meets Eligibility?}
        D -->|No| E[Show Ineligible Criteria]
        D -->|Yes| F[Slot Instantly Reserved]
        
        %% Application Required Path
        B -->|Application Required| G[Creator clicks APPLY]
        G --> H[Submit Application Snapshot]
        H --> I[Brand Reviews Applicant Snapshot]
        I -->|Reject| J[Application Rejected Notification]
        I -->|Approve| F
    end

    subgraph Production["Phase 2: Production & Deliverable Gate"]
        F --> K[Creative Brief & Tracking Assets Unlocked]
        K --> L[Creator Produces Content]
        L --> M[Creator Submits Draft Deliverable]
        M --> N{Brand Content Review}
        N -->|Request Changes| O[Creator Revises Draft]
        O --> M
        N -->|Approved| P{Content Destination?}
    end

    subgraph Fulfillment["Phase 3: Fulfillment & Settlement"]
        P -->|Creator Page / Both| Q[Creator Publishes with Tracking Codes/Sound]
        P -->|Brand Page Only| R[Brand Downloads High-Res Asset]
        Q --> S[Real-Time Tracking: Views or Conversion Webhooks]
        R --> T[Escrow Release / Wallet Balance Credited]
        S --> T
    end

    style D fill:#f0fdf4,stroke:#16a34a,stroke-width:2px
    style I fill:#eff6ff,stroke:#2563eb,stroke-width:2px
    style N fill:#fef3c7,stroke:#d97706,stroke-width:2px
    style T fill:#ecfdf5,stroke:#059669,stroke-width:2px
```

---

## 2. Rate-Setting Authority & Budget Routing by Objective

Different campaign objectives route rate-setting authority to different parties.

```mermaid
flowchart LR
    subgraph BrandWizard["Brand Campaign Creation Wizard"]
        Obj[Campaign Objective Selected]
        Comp[Compensation Structure: Fixed / Performance / Hybrid]
    end

    subgraph AuthorityRouting["Rate-Setting Authority"]
        Obj -->|Content| BrandRate["Brand Sets Creator Rate<br><i>e.g. ₦15,000 / approved video</i>"]
        Obj -->|Sign-ups / Downloads| AdminRate["Brand Sets Total Budget<br>Admin Sets Creator Payout Rate<br><i>e.g. ₦250 / verified conversion</i>"]
        Obj -->|Views| PlatformRate["EasilyPromote Standard Rate<br><i>Matrix based on view tier</i>"]
    end

    subgraph SettlementEngine["Escrow & Fee Split"]
        BrandRate --> Split["Budget Split:<br>Creator Pool + Platform Fee"]
        AdminRate --> Split
        PlatformRate --> Split
        Split --> Paystack["Paystack Escrow Checkout"]
    end

    style BrandRate fill:#eff6ff,stroke:#3b82f6,stroke-width:2px
    style AdminRate fill:#fdf2f8,stroke:#ec4899,stroke-width:2px
    style PlatformRate fill:#f0fdf4,stroke:#22c55e,stroke-width:2px
```

---

## 3. Contextual Prioritization in Brand Applicant Review

When a brand reviews creator applications, the view dynamically prioritizes data matching the campaign's targeting criteria.

```mermaid
flowchart TD
    Application[Creator Application Received] --> Engine[Contextual Scoring & Ordering]
    
    Engine --> CheckTarget{Primary Campaign Criteria?}
    
    CheckTarget -->|Location: e.g. Lagos| PrioritizeLocation[Prioritize Audience Location breakdown<br><b>e.g. 82% Lagos Audience highlighted first</b>]
    CheckTarget -->|Performance / Action| PrioritizePerformance[Prioritize Conversion Track Record<br><b>e.g. Past campaign conversion % & avg views</b>]
    CheckTarget -->|Niche / Category| PrioritizePortfolio[Prioritize Category Showcase<br><b>e.g. Relevant niche portfolio videos first</b>]
    
    PrioritizeLocation --> RenderView[Render Condensed Snapshot Card]
    PrioritizePerformance --> RenderView
    PrioritizePortfolio --> RenderView
    
    RenderView --> BrandDecision{Brand Decision}
    BrandDecision -->|APPROVE| ApproveAction[Slot Allocated & Brief Unlocked]
    BrandDecision -->|REJECT| RejectAction[Applicant Notified]
```

---

## 4. State Machine: Campaign, Application, and Submission

```mermaid
stateDiagram-v2
    [*] --> Draft: Brand creates campaign
    Draft --> PendingPayment: Wizard completed
    PendingPayment --> Live: Paystack payment verified
    
    state Live {
        state "Creator Gating" as Gate1 {
            [*] --> OpenCallJoin: Open Call
            [*] --> Applied: Application Required
            Applied --> Approved: Brand reviews & selects
            Applied --> Rejected: Brand declines
        }
        
        state "Content Gating" as Gate2 {
            Approved --> BriefUnlocked
            OpenCallJoin --> BriefUnlocked
            BriefUnlocked --> ContentSubmitted: Creator uploads draft
            ContentSubmitted --> ContentRevision: Brand requests changes
            ContentRevision --> ContentSubmitted
            ContentSubmitted --> ContentApproved: Brand approves
        }
        
        state "Settlement" as Gate3 {
            ContentApproved --> LiveTracking: If Creator Channel
            ContentApproved --> PaidOut: If Brand Channel Only
            LiveTracking --> PaidOut: Views/Conversions verified
        }
    }
    
    Live --> Completed: Budget fulfilled / Date passed
    Live --> Paused: Brand or Admin pauses
```
