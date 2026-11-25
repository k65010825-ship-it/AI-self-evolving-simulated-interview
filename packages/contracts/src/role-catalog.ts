import {z} from 'zod';
import {RoleIdSchema,type RoleId} from './tools.ts';

export const ROLE_CATALOG_VERSION='role-catalog-v1' as const;
export const PracticeModeSchema=z.enum(['weakness-focus','broad-coverage']);
export type PracticeMode=z.infer<typeof PracticeModeSchema>;

export const RoleSkillCategorySchema=z.enum(['main','behavioral']);
export const RoleSkillDefinitionSchema=z.object({
 skillId:z.string().min(1).max(100),
 label:z.string().min(1).max(120),
 category:RoleSkillCategorySchema,
 relevance:z.number().min(0).max(1),
}).strict();

export const ROLE_SKILL_CATALOG={
 'java-backend':{
  id:'java-backend' as const,
  label:'Java 后端',
  mainSkills:[
   {skillId:'java-jvm',label:'Java 与 JVM',category:'main' as const,relevance:1},
   {skillId:'java-concurrency',label:'Java 并发',category:'main' as const,relevance:0.95},
   {skillId:'spring-transactions',label:'Spring 与事务',category:'main' as const,relevance:0.9},
   {skillId:'database-concurrency',label:'数据库与并发',category:'main' as const,relevance:0.85},
   {skillId:'cache-distributed',label:'缓存与分布式',category:'main' as const,relevance:0.8},
   {skillId:'project-design',label:'项目设计',category:'main' as const,relevance:0.75},
  ],
  behavioralSkills:[
   {skillId:'collaboration',label:'协作与沟通表达',category:'behavioral' as const,relevance:0.7},
  ],
 },
 'web-frontend':{
  id:'web-frontend' as const,
  label:'Web 前端',
  mainSkills:[
   {skillId:'javascript',label:'JavaScript / TypeScript',category:'main' as const,relevance:1},
   {skillId:'browser-network',label:'浏览器与网络',category:'main' as const,relevance:0.95},
   {skillId:'react',label:'React 原理与实践',category:'main' as const,relevance:0.9},
   {skillId:'async-state',label:'异步与状态管理',category:'main' as const,relevance:0.85},
   {skillId:'performance-accessibility',label:'性能与可访问性',category:'main' as const,relevance:0.8},
   {skillId:'project-design',label:'项目设计',category:'main' as const,relevance:0.75},
  ],
  behavioralSkills:[
   {skillId:'collaboration',label:'协作与沟通表达',category:'behavioral' as const,relevance:0.7},
  ],
 },
} as const;

export const RoleSkillCatalogEntrySchema=RoleSkillDefinitionSchema.extend({
 draftCount:z.number().int().nonnegative(),
 reviewedCount:z.number().int().nonnegative(),
 availableInReviewedOnly:z.boolean(),
 availableInDraftPreview:z.boolean(),
}).strict();

export const RoleCatalogEntrySchema=z.object({
 id:RoleIdSchema,
 label:z.string().min(1).max(80),
 catalogVersion:z.literal(ROLE_CATALOG_VERSION),
 mainSkillCount:z.literal(6),
 skills:z.array(RoleSkillCatalogEntrySchema).length(6),
 behavioralSkills:z.array(RoleSkillCatalogEntrySchema).length(1),
}).strict();

export const RoleListSchema=z.array(RoleCatalogEntrySchema).length(2);
export type RoleCatalogEntry=z.infer<typeof RoleCatalogEntrySchema>;
export type RoleList=z.infer<typeof RoleListSchema>;

export function roleSkillDefinitions(roleId:RoleId){
 const entry=ROLE_SKILL_CATALOG[roleId];
 return [...entry.mainSkills,...entry.behavioralSkills];
}
export function roleSkillConfigs(roleId:RoleId){
 return roleSkillDefinitions(roleId).map(({skillId,relevance})=>({skillId,relevance}));
}
export function roleSkillLabels(roleId:RoleId){
 return Object.fromEntries(roleSkillDefinitions(roleId).map(s=>[s.skillId,s.label]));
}
