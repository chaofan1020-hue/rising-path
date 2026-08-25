import { z } from 'zod';

const shortText = z.string().trim().max(255);
const valueText = z.string().trim().max(4_000);

export const applicationSemanticKeySchema = z.enum([
  'first_name', 'last_name', 'full_name', 'email', 'phone', 'address', 'city',
  'state', 'zip_code', 'country', 'linkedin', 'github', 'portfolio',
  'work_authorization', 'visa_status', 'summary', 'skills', 'languages',
]);

export const prefillFeedbackRequestSchema = z.object({
  version: z.number().int().min(0),
  jobId: z.number().int().positive().optional(),
  domain: z.string().trim().max(255).optional(),
  fields: z.array(z.object({
    fieldKey: shortText,
    semanticKey: applicationSemanticKeySchema.optional(),
    suggestedValue: valueText.optional(),
    finalValue: valueText.optional(),
    action: z.enum(['confirmed', 'edited', 'ignored']),
  }).strict()).min(1).max(50),
}).strict();

export const fieldMappingSchema = z.object({
  company_pattern: shortText.min(1),
  field_name: shortText.min(1),
  target_field: shortText.min(1),
}).strict();

export const fieldMappingsRequestSchema = z.object({
  mappings: z.array(fieldMappingSchema).max(200),
}).strict();

const profileStringRecord = z.record(z.string(), z.string().max(4_000));
const profileEntry = z.record(z.string(), z.string().max(4_000));

export const applicationProfilePatchSchema = z.object({
  version: z.number().int().min(0),
  profile: z.object({
    personal: profileStringRecord.optional(),
    links: profileStringRecord.optional(),
    education: z.array(profileEntry).max(20).optional(),
    experience: z.array(profileEntry).max(30).optional(),
    skills: z.array(shortText).max(100).optional(),
    languages: z.array(shortText).max(50).optional(),
    workAuthorization: valueText.optional(),
    visaStatus: valueText.optional(),
    summary: valueText.optional(),
  }).strict(),
}).strict();

export const applicationPrefillRequestSchema = z.object({
  resumeId: z.number().int().positive().optional(),
  jobId: z.number().int().positive().optional(),
  company: shortText.optional(),
  fields: z.array(z.object({
    key: shortText.min(1),
    label: shortText.max(500),
    type: z.enum(['text', 'textarea', 'email', 'tel', 'url', 'select', 'radio', 'checkbox', 'file', 'date', 'number']),
    required: z.boolean().optional(),
    name: shortText.optional(),
    id: shortText.optional(),
    placeholder: shortText.max(500).optional(),
    options: z.array(shortText).max(100).optional(),
    // The extension carries a numeric DOM index and may encounter fields
    // outside the profile's known semantic-key set. The server still bounds
    // the values, while the field-specific logic decides what can be mapped.
    selectorHints: z.object({
      semanticKey: shortText.optional(),
    }).catchall(z.union([shortText, z.number().int().min(0).max(10_000)])).optional(),
  }).strict()).min(1).max(100),
}).strict();
