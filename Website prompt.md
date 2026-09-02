# PROMPT: Build Public Policy & Economic Research Web Platform

## Context & Strategic Mission
You are an expert full-stack AI development partner in Antigravity. Build a web platform that democratizes high-rigor research, datasets, and insights to empower Indian citizens and market actors[cite: 1]. The platform combines law, economics, policy, and finance into an interdisciplinary, evidence-based research portal[cite: 1, 2].

## Technical Architecture & Free Hosting Setup
* **Frontend Framework:** Build an Astro static site for fast loading and zero-cost hosting[cite: 2].
* **Free Hosting Pipeline:** Configure automated deployment scripts targeting Vercel or Netlify free tiers with SSL enabled.
* **No-Code Backend CMS:** Integrate Decap CMS (Git-based) or Supabase (Free Tier) to enable zero-code content management, paper publishing, and dataset uploads via a visual `/admin` dashboard.
* **Data Ingestion:** Create structured database schemas and file upload inputs supporting CSV, JSON, and PDF files for open-access datasets[cite: 1].

## Stakeholder Experience & UI Design
* **Civic Actor Hub:** Design interactive research feeds tailored for informed voters, civic advocates, and youth[cite: 3].
* **Market Actor Portal:** Build specialized analytical dashboards for impact investors, VC fund managers, and corporate ESG teams[cite: 3].
* **Anti-Audience Exclusions:** Explicitly exclude clickbait layout patterns, sensationalized headlines, or partisan political messaging[cite: 3, 4].

## Editorial Rules & Output Constraints
* **Thesis-First Framing:** Ensure every publication page opens with a plain-language summary limited to 3–4 sentences[cite: 5].
* **Terminology Callouts:** Isolate technical domain terms inside dedicated Markdown callout boxes (`> **Terminology:** ...`) directly following technical sections[cite: 5].
* **Verification Standards:** Maintain a zero-tolerance policy for unverified claims by pairing all data points with inline primary citations[cite: 2, 4].
* **Zero Fluff Directives:** Ban sensationalized jargon ("game-changer", "paradigm shift"), rhetorical flourishes, and conversational setup intros[cite: 2, 5].

## Execution Checklist for Antigravity
1. Scaffolding: Initialize the repository using Astro, Tailwind CSS, and Decap CMS or Supabase integration.
2. Components: Build reusable UI components for data tables, research cards, inline citation anchors, and definition callout boxes.
3. Preview & Hosting: Spin up the local development server (`http://localhost:3000`) and generate a 1-click Vercel/Netlify deployment workflow.
4. Backend Access: Ensure the `/admin` route provides an intuitive, code-free interface for uploading datasets and editing research briefs.