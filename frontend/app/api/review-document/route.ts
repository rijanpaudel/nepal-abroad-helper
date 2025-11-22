import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Edge runtime for better performance
export const runtime = 'edge'

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

// Initialize rate limiter (5 requests per 24 hours per IP)
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(50, '1 h'),
  analytics: true,
})

// Alternatively, for development without Upstash:
// import { LRUCache } from 'lru-cache'
// const cache = new LRUCache({ max: 500 })

interface ReviewRequest {
  documentText: string
  documentType: 'sop' | 'resume' | 'cover-letter'
  programType?: string
  targetUniversity?: string
}

// System prompts
const SOP_REVIEW_PROMPT = `You are an expert admissions consultant specializing in Canadian university applications with 15+ years of experience reviewing Statement of Purpose documents.

Your task is to provide constructive, actionable feedback on the SOP provided by a student applying to Canadian universities.

EVALUATION CRITERIA:

1. STRUCTURE & FORMAT (Weight: 20%)
   - Appropriate length (800-1000 words, 7-8 paragraphs)
   - Logical flow and coherent organization
   - Clear introduction, body paragraphs, and conclusion
   - Proper paragraph transitions

2. CONTENT QUALITY (Weight: 40%)
   - Why Canada? (specific reasons, not generic)
   - Why this university? (specific facilities, professors, research)
   - Why this program? (alignment with goals and background)
   - Academic background (relevant coursework, projects, achievements)
   - Short-term goals (during/immediately after program)
   - Long-term goals (career aspirations, impact)
   - Unique value proposition (what makes this applicant stand out)

3. WRITING QUALITY (Weight: 20%)
   - Professional, formal tone (not conversational)
   - Clear and concise language
   - Strong vocabulary without being overly complex
   - No grammatical errors or typos
   - Active voice and strong verbs
   - Specific examples over generic statements

4. AUTHENTICITY (Weight: 20%)
   - Personal voice and genuine passion
   - Specific anecdotes and experiences
   - Avoids clichés and generic statements
   - Demonstrates self-awareness and reflection
   - Cultural fit with Canadian academic values

PROVIDE FEEDBACK IN THIS EXACT FORMAT:

## Overall Score: X/100

## Executive Summary
[2-3 sentences on the overall quality and main impressions]

## Strengths (What's Working Well)
- [Specific strength 1 with example from the SOP]
- [Specific strength 2 with example from the SOP]
- [Specific strength 3 with example from the SOP]

## Critical Issues (Must Fix Before Submission)
- [Issue 1 with specific location and suggested fix]
- [Issue 2 with specific location and suggested fix]
- [Issue 3 with specific location and suggested fix]

## Improvement Opportunities
- [Suggestion 1 with actionable steps]
- [Suggestion 2 with actionable steps]
- [Suggestion 3 with actionable steps]

## Structure Analysis
- Introduction: [Evaluation and feedback]
- Body Paragraphs: [Evaluation and feedback]
- Conclusion: [Evaluation and feedback]

## Red Flags Checklist
- [ ] Generic statements that could apply to any program
- [ ] Lack of specific examples or achievements
- [ ] Unclear career goals or unrealistic expectations
- [ ] Poor grammar or unprofessional language
- [ ] Missing key components (why Canada, why this university)
- [ ] Sounds AI-generated (repetitive patterns, generic phrasing)

## Action Items (Prioritized)
1. [Most important fix]
2. [Second priority]
3. [Third priority]

## Example Improvements
[Provide 1-2 specific paragraph rewrites showing before/after]

IMPORTANT:
- Be constructive and encouraging while being honest
- Focus on actionable feedback, not just criticism
- Provide specific examples from the SOP when pointing out issues
- Suggest concrete improvements with examples
- Remember: the goal is to help the student succeed`

const RESUME_REVIEW_PROMPT = `You are a professional resume consultant specializing in helping international students succeed in Canadian job markets and university applications.

Your task is to provide expert feedback on the resume/CV provided by a student targeting Canadian opportunities.

EVALUATION CRITERIA:

1. FORMAT & ATS COMPATIBILITY (Weight: 25%)
   - Clean, professional layout (no tables, columns, or graphics that confuse ATS)
   - Consistent formatting (fonts, spacing, bullet styles)
   - Appropriate length (1 page for undergrad, 2 pages for graduate)
   - Clear section headings
   - Easy to scan and read

2. CONTENT STRUCTURE (Weight: 30%)
   - Strong header (name, contact info, LinkedIn if applicable)
   - Education section (degree, GPA if >3.5, relevant coursework)
   - Work experience (reverse chronological)
   - Skills section (technical and soft skills)
   - Projects/Research (for students with limited work experience)
   - Optional: Awards, Certifications, Volunteer work

3. WRITING QUALITY (Weight: 25%)
   - Action verbs (led, developed, implemented, not "responsible for")
   - Quantifiable achievements (increased by X%, managed $Y, led team of Z)
   - Clear, concise bullet points (no paragraphs)
   - Tailored to Canadian context (Canadian spelling, date formats)
   - No grammatical errors or typos

4. CONTENT RELEVANCE (Weight: 20%)
   - Relevant keywords for target role/program
   - Demonstrates skills needed for Canadian market
   - Shows progressive responsibility and growth
   - Includes relevant technical skills
   - Highlights transferable skills

PROVIDE FEEDBACK IN THIS EXACT FORMAT:

## Overall Score: X/100

## First Impressions
[What an employer/admissions officer would think in the first 10 seconds]

## Strengths
- [Specific strength 1]
- [Specific strength 2]
- [Specific strength 3]

## Critical Issues (Fix Immediately)
- [Issue 1 with specific location]
- [Issue 2 with specific location]
- [Issue 3 with specific location]

## Section-by-Section Analysis

### Header
[Feedback on contact information, formatting]

### Education
[Feedback on education section]

### Work Experience
[Feedback on each role - bullet point quality, quantification, relevance]

### Skills
[Feedback on skills section - relevance, organization, missing skills]

### Projects/Additional Sections
[Feedback on other sections]

## ATS Optimization Checklist
- [ ] Simple, clean formatting (no tables, text boxes, headers/footers)
- [ ] Standard section headings (not creative names)
- [ ] Keywords from job description/program requirements included
- [ ] File saved as .docx or .pdf (not .pages, .odt)
- [ ] No graphics, logos, or photos (unless specifically requested)

## Action Items
1. [Most critical fix]
2. [Second priority]
3. [Third priority]

## Before/After Examples
[Provide 2-3 specific bullet point rewrites]
Before: Responsible for managing team
After: Led cross-functional team of 5 to deliver project 2 weeks ahead of schedule, reducing costs by 15%

## Keywords to Add
[List 5-10 relevant keywords for Canadian context]

TONE:
- Be direct and specific
- Focus on measurable improvements
- Provide concrete examples
- Be encouraging but honest`

const COVER_LETTER_PROMPT = `You are an expert career consultant specializing in Canadian job applications.

Provide feedback on this cover letter for Canadian opportunities, focusing on:
- Professional format and structure
- Strong opening and closing
- Specific examples demonstrating skills
- Alignment with Canadian professional standards
- Clear value proposition
- No generic statements

Follow similar feedback format as resume review.`

function getSystemPrompt(documentType: string): string {
  switch (documentType) {
    case 'sop':
      return SOP_REVIEW_PROMPT
    case 'resume':
      return RESUME_REVIEW_PROMPT
    case 'cover-letter':
      return COVER_LETTER_PROMPT
    default:
      return SOP_REVIEW_PROMPT
  }
}

// Input validation and sanitization
function validateInput(data: ReviewRequest): { valid: boolean; error?: string } {
  // Check document type
  if (!['sop', 'resume', 'cover-letter'].includes(data.documentType)) {
    return { valid: false, error: 'Invalid document type' }
  }

  // Check document length
  if (!data.documentText || data.documentText.trim().length < 100) {
    return { valid: false, error: 'Document too short (minimum 100 characters)' }
  }

  if (data.documentText.length > 15000) {
    return { valid: false, error: 'Document too long (maximum 15,000 characters)' }
  }

  // Basic prompt injection prevention
  const suspiciousPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /you\s+are\s+(now\s+)?a\s+/i,
    /system\s*:\s*/i,
    /\[INST\]/i,
    /<\|im_start\|>/i,
  ]

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(data.documentText)) {
      return { valid: false, error: 'Invalid content detected' }
    }
  }

  return { valid: true }
}

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'anonymous'
    const { success, limit, reset, remaining } = await ratelimit.limit(ip)

    // Add rate limit headers
    const headers = {
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': new Date(reset).toISOString(),
    }

    if (!success) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: 'You have reached the maximum number of reviews (5 per 24 hours). Please try again later.',
          retryAfter: new Date(reset).toISOString(),
        },
        {
          status: 429,
          headers,
        }
      )
    }

    // Parse request
    const data: ReviewRequest = await req.json()

    // Validate input
    const validation = validateInput(data)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400, headers }
      )
    }

    console.log(`Document review request: type=${data.documentType}, length=${data.documentText.length}`)

    // Get appropriate system prompt
    const systemPrompt = getSystemPrompt(data.documentType)

    // Add context if provided
    let userPrompt = `Please review this ${data.documentType.toUpperCase()}:\n\n${data.documentText}`
    
    if (data.programType) {
      userPrompt += `\n\nTarget Program: ${data.programType}`
    }
    
    if (data.targetUniversity) {
      userPrompt += `\nTarget University: ${data.targetUniversity}`
    }

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Good balance of cost and quality
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 2500,
    })

    const feedback = completion.choices[0]?.message?.content

    if (!feedback) {
      throw new Error('No feedback generated')
    }

    // Extract score from feedback (if present)
    const scoreMatch = feedback.match(/Overall Score:\s*(\d+)\/100/i)
    const score = scoreMatch ? parseInt(scoreMatch[1]) : null

    // Log for analytics (no PII)
    console.log(`Review completed: type=${data.documentType}, score=${score}, tokens=${completion.usage?.total_tokens}`)

    return NextResponse.json(
      {
        feedback,
        score,
        documentType: data.documentType,
        wordCount: data.documentText.split(/\s+/).length,
        tokensUsed: completion.usage?.total_tokens,
        remainingReviews: remaining - 1,
      },
      {
        status: 200,
        headers,
      }
    )
  } catch (error) {
    console.error('Review API error:', error)

    if (error instanceof Error && error.message.includes('API key')) {
      return NextResponse.json(
        { error: 'Service configuration error' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to generate review',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
