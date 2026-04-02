import { pgTable, serial, timestamp, varchar, text, jsonb, index, integer } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 岗位信息表
export const jobs = pgTable(
  "jobs",
  {
    id: serial().primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    company: varchar("company", { length: 255 }).notNull(),
    region: varchar("region", { length: 100 }).notNull(), // 地区：北美、欧洲、亚太等
    direction: varchar("direction", { length: 100 }).notNull(), // 方向：技术、产品、设计、运营等
    audience: varchar("audience", { length: 100 }).notNull(), // 受众：应届生、社招、实习等
    description: text("description"),
    requirements: text("requirements"),
    salary_range: varchar("salary_range", { length: 100 }),
    job_url: varchar("job_url", { length: 500 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("jobs_region_idx").on(table.region),
    index("jobs_direction_idx").on(table.direction),
    index("jobs_audience_idx").on(table.audience),
    index("jobs_created_at_idx").on(table.created_at),
  ]
);

// 简历表
export const resumes = pgTable(
  "resumes",
  {
    id: serial().primaryKey(),
    file_key: varchar("file_key", { length: 500 }).notNull(), // 对象存储中的key
    file_name: varchar("file_name", { length: 255 }).notNull(),
    parsed_content: text("parsed_content"), // 解析后的文本内容
    user_info: jsonb("user_info"), // 结构化用户信息（姓名、教育、工作经历等）
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("resumes_created_at_idx").on(table.created_at),
  ]
);

// 网申记录表
export const applications = pgTable(
  "applications",
  {
    id: serial().primaryKey(),
    job_id: integer("job_id").notNull().references(() => jobs.id),
    resume_id: integer("resume_id").notNull().references(() => resumes.id),
    status: varchar("status", { length: 50 }).notNull().default("pending"), // pending, submitted, interview, rejected, offer
    notes: text("notes"), // 用户备注
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("applications_job_id_idx").on(table.job_id),
    index("applications_resume_id_idx").on(table.resume_id),
    index("applications_status_idx").on(table.status),
    index("applications_created_at_idx").on(table.created_at),
  ]
);

// 网申字段映射表（用于学习和记录企业网申字段）
export const applicationFields = pgTable(
  "application_fields",
  {
    id: serial().primaryKey(),
    job_id: integer("job_id").notNull().references(() => jobs.id),
    field_name: varchar("field_name", { length: 255 }).notNull(), // 字段名称
    field_value: text("field_value"), // 字段值
    field_type: varchar("field_type", { length: 50 }), // 字段类型：text, select, checkbox等
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("application_fields_job_id_idx").on(table.job_id),
  ]
);

// AI匹配记录表
export const aiMatches = pgTable(
  "ai_matches",
  {
    id: serial().primaryKey(),
    resume_id: integer("resume_id").notNull().references(() => resumes.id),
    job_id: integer("job_id").notNull().references(() => jobs.id),
    match_score: integer("match_score").notNull(), // 匹配分数 0-100
    match_reason: text("match_reason"), // 匹配原因分析
    suggestions: text("suggestions"), // 优化建议
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_matches_resume_id_idx").on(table.resume_id),
    index("ai_matches_job_id_idx").on(table.job_id),
  ]
);
