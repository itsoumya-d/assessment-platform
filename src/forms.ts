import { z } from "zod";
import { Database } from "./db.js";
import { NotFoundError, ValidationError } from "./service.js";

export const FieldTypeSchema = z.enum(["text", "number", "select", "multiselect", "boolean", "date"]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const OperatorSchema = z.enum(["equals", "not_equals", "greater_than", "less_than", "contains"]);
export type Operator = z.infer<typeof OperatorSchema>;

export const ConditionalRuleSchema = z.object({
  targetField: z.string().min(1),
  operator: OperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean()])
});
export type ConditionalRule = z.infer<typeof ConditionalRuleSchema>;

export const FormFieldSchema = z.object({
  key: z.string().min(1).regex(/^[a-zA-Z0-9_]+$/, "Field key must be alphanumeric or underscore"),
  label: z.string().min(1),
  type: FieldTypeSchema,
  required: z.boolean().optional().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  options: z.array(z.string().min(1)).optional(),
  unit: z.string().optional(),
  condition: ConditionalRuleSchema.optional()
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormDefinitionSchema = z.object({
  code: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, "Form code must be alphanumeric, hyphen or underscore"),
  version: z.number().int().positive().default(1),
  title: z.string().min(1),
  description: z.string().optional().default(""),
  fields: z.array(FormFieldSchema).min(1, "Form must have at least one field")
});
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;

export interface FormError {
  field: string;
  rule: string;
  message: string;
}

export interface FormEvaluationResult {
  valid: boolean;
  activeFields: string[];
  values: Record<string, unknown>;
  errors: FormError[];
}

export function validateDefinitionRules(def: FormDefinition): void {
  const seenKeys = new Set<string>();
  for (let i = 0; i < def.fields.length; i++) {
    const f = def.fields[i];
    if (seenKeys.has(f.key)) {
      throw new ValidationError(`Duplicate field key '${f.key}' in form definition`);
    }
    if ((f.type === "select" || f.type === "multiselect") && (!f.options || f.options.length === 0)) {
      throw new ValidationError(`Field '${f.key}' of type '${f.type}' requires non-empty options array`);
    }
    if (f.pattern) {
      try {
        new RegExp(f.pattern);
      } catch {
        throw new ValidationError(`Field '${f.key}' has invalid regex pattern: '${f.pattern}'`);
      }
    }
    if (f.condition) {
      if (!seenKeys.has(f.condition.targetField)) {
        throw new ValidationError(`Field '${f.key}' references non-existent or subsequent targetField '${f.condition.targetField}'`);
      }
    }
    seenKeys.add(f.key);
  }
}

export function evaluateCondition(rule: ConditionalRule, targetValue: unknown): boolean {
  if (targetValue === undefined || targetValue === null) return false;
  switch (rule.operator) {
    case "equals":
      return targetValue === rule.value;
    case "not_equals":
      return targetValue !== rule.value;
    case "greater_than":
      return typeof targetValue === "number" && typeof rule.value === "number" && targetValue > rule.value;
    case "less_than":
      return typeof targetValue === "number" && typeof rule.value === "number" && targetValue < rule.value;
    case "contains":
      if (Array.isArray(targetValue)) {
        return targetValue.includes(rule.value as string);
      }
      return String(targetValue).includes(String(rule.value));
    default:
      return false;
  }
}

export function evaluateForm(def: FormDefinition, rawInput: Record<string, unknown>): FormEvaluationResult {
  const activeFields: string[] = [];
  const sanitizedValues: Record<string, unknown> = {};
  const errors: FormError[] = [];

  for (const f of def.fields) {
    let active = true;
    if (f.condition) {
      active = evaluateCondition(f.condition, sanitizedValues[f.condition.targetField]);
    }

    if (!active) {
      continue;
    }

    activeFields.push(f.key);
    const val = rawInput[f.key];

    if (val === undefined || val === null || val === "") {
      if (f.required) {
        errors.push({ field: f.key, rule: "required", message: `Field '${f.label}' is required` });
      }
      continue;
    }

    switch (f.type) {
      case "number": {
        const num = Number(val);
        if (Number.isNaN(num)) {
          errors.push({ field: f.key, rule: "type", message: `Field '${f.label}' must be a valid number` });
        } else {
          if (f.min !== undefined && num < f.min) {
            errors.push({ field: f.key, rule: "min", message: `Field '${f.label}' must be at least ${f.min}${f.unit ? ' ' + f.unit : ''}` });
          }
          if (f.max !== undefined && num > f.max) {
            errors.push({ field: f.key, rule: "max", message: `Field '${f.label}' must be at most ${f.max}${f.unit ? ' ' + f.unit : ''}` });
          }
          sanitizedValues[f.key] = num;
        }
        break;
      }
      case "text": {
        const str = String(val);
        if (f.pattern) {
          const rx = new RegExp(f.pattern);
          if (!rx.test(str)) {
            errors.push({ field: f.key, rule: "pattern", message: `Field '${f.label}' does not match required format` });
          }
        }
        sanitizedValues[f.key] = str;
        break;
      }
      case "select": {
        const str = String(val);
        if (f.options && !f.options.includes(str)) {
          errors.push({ field: f.key, rule: "options", message: `Field '${f.label}' must be one of: ${f.options.join(", ")}` });
        } else {
          sanitizedValues[f.key] = str;
        }
        break;
      }
      case "multiselect": {
        if (!Array.isArray(val)) {
          errors.push({ field: f.key, rule: "type", message: `Field '${f.label}' must be an array of selections` });
        } else {
          const invalid = val.filter(item => !f.options?.includes(String(item)));
          if (invalid.length > 0) {
            errors.push({ field: f.key, rule: "options", message: `Field '${f.label}' has invalid selections: ${invalid.join(", ")}` });
          } else {
            sanitizedValues[f.key] = val.map(String);
          }
        }
        break;
      }
      case "boolean": {
        if (typeof val === "boolean") {
          sanitizedValues[f.key] = val;
        } else if (val === "true" || val === "false") {
          sanitizedValues[f.key] = val === "true";
        } else {
          errors.push({ field: f.key, rule: "type", message: `Field '${f.label}' must be a boolean value` });
        }
        break;
      }
      case "date": {
        const d = new Date(String(val));
        if (Number.isNaN(d.getTime())) {
          errors.push({ field: f.key, rule: "type", message: `Field '${f.label}' must be a valid date string` });
        } else {
          sanitizedValues[f.key] = d.toISOString();
        }
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    activeFields,
    values: sanitizedValues,
    errors
  };
}

export class FormEngineService {
  constructor(private readonly db: Database) {}

  async registerForm(definition: FormDefinition): Promise<{ code: string; version: number; fieldsCount: number }> {
    validateDefinitionRules(definition);
    const existing = await this.db.query<{ id: number; version: number }>(
      "SELECT id, version FROM form_definitions WHERE code = $1",
      [definition.code]
    );

    const nextVersion = existing.length > 0 ? (existing[0].version + 1) : (definition.version || 1);
    const jsonStr = JSON.stringify({ ...definition, version: nextVersion });

    if (existing.length > 0) {
      await this.db.query(
        "UPDATE form_definitions SET version = $1, title = $2, description = $3, definition = $4 WHERE code = $5",
        [nextVersion, definition.title, definition.description || "", jsonStr, definition.code]
      );
    } else {
      await this.db.query(
        "INSERT INTO form_definitions (code, version, title, description, definition) VALUES ($1, $2, $3, $4, $5)",
        [definition.code, nextVersion, definition.title, definition.description || "", jsonStr]
      );
    }

    return {
      code: definition.code,
      version: nextVersion,
      fieldsCount: definition.fields.length
    };
  }

  async getForm(code: string): Promise<FormDefinition> {
    const rows = await this.db.query<{ definition: string }>(
      "SELECT definition FROM form_definitions WHERE code = $1",
      [code]
    );
    if (rows.length === 0) {
      throw new NotFoundError(`Form definition with code '${code}' not found`);
    }
    return JSON.parse(rows[0].definition) as FormDefinition;
  }

  async validateSubmission(code: string, inputValues: Record<string, unknown>): Promise<FormEvaluationResult> {
    const def = await this.getForm(code);
    return evaluateForm(def, inputValues);
  }
}
