import { z } from 'zod';

const contactSchema = z.object({
  email: z.string().default(''),
  phone: z.string().default(''),
  location: z.string().default(''),
  linkedin: z.string().default(''),
});

const experienceSchema = z.object({
  title: z.string().default(''),
  company: z.string().default(''),
  location: z.string().default(''),
  period: z.string().default(''),
  highlights: z.array(z.string()).default([]),
});

const educationSchema = z.object({
  degree: z.string().default(''),
  school: z.string().default(''),
  major: z.string().default(''),
  period: z.string().default(''),
  gpa: z.string().default(''),
});

const projectSchema = z.object({
  name: z.string().default(''),
  role: z.string().default(''),
  period: z.string().default(''),
  description: z.string().default(''),
  highlights: z.array(z.string()).default([]),
});

const changeItemSchema = z.object({
  id: z.string().trim().min(1).max(100),
  section: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  before: z.string().max(2000),
  after: z.string().trim().min(1).max(2000),
  rationale: z.string().trim().min(1).max(1000),
});

export const optimizationChangeStateSchema = changeItemSchema.extend({
  status: z.enum(['pending', 'accepted', 'rejected']),
});

export type OptimizationChange = z.infer<typeof optimizationChangeStateSchema>;

export const optimizedResumeSchema = z.object({
  name: z.string().default(''),
  contact: contactSchema.default({
    email: '',
    phone: '',
    location: '',
    linkedin: '',
  }),
  summary: z.string().default(''),
  skills: z.array(z.string()).default([]),
  experience: z.array(experienceSchema).default([]),
  education: z.array(educationSchema).default([]),
  projects: z.array(projectSchema).default([]),
  certifications: z.array(z.string()).default([]),
  change_items: z.array(changeItemSchema).default([]),
});

export type OptimizedResumeData = z.infer<typeof optimizedResumeSchema>;

export const OPTIMIZED_RESUME_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    contact: {
      type: 'object',
      additionalProperties: false,
      properties: {
        email: { type: 'string' },
        phone: { type: 'string' },
        location: { type: 'string' },
        linkedin: { type: 'string' },
      },
      required: ['email', 'phone', 'location', 'linkedin'],
    },
    summary: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          location: { type: 'string' },
          period: { type: 'string' },
          highlights: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'company', 'location', 'period', 'highlights'],
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          degree: { type: 'string' },
          school: { type: 'string' },
          major: { type: 'string' },
          period: { type: 'string' },
          gpa: { type: 'string' },
        },
        required: ['degree', 'school', 'major', 'period', 'gpa'],
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          period: { type: 'string' },
          description: { type: 'string' },
          highlights: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'role', 'period', 'description', 'highlights'],
      },
    },
    certifications: { type: 'array', items: { type: 'string' } },
    change_items: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 100 },
          section: { type: 'string', minLength: 1, maxLength: 100 },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          before: { type: 'string', maxLength: 2000 },
          after: { type: 'string', minLength: 1, maxLength: 2000 },
          rationale: { type: 'string', minLength: 1, maxLength: 1000 },
        },
        required: ['id', 'section', 'title', 'before', 'after', 'rationale'],
      },
    },
  },
  required: [
    'name',
    'contact',
    'summary',
    'skills',
    'experience',
    'education',
    'projects',
    'certifications',
    'change_items',
  ],
};

export function parseOptimizedResume(raw: string): OptimizedResumeData {
  const normalized = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return optimizedResumeSchema.parse(JSON.parse(normalized));
  } catch (firstError) {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');
    if (start < 0 || end <= start) throw firstError;
    return optimizedResumeSchema.parse(JSON.parse(normalized.slice(start, end + 1)));
  }
}
