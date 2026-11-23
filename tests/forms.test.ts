import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testDatabase } from "./core.test.js";
import { FormDefinition } from "../src/forms.js";

describe("configurable form engine and dynamic validation", () => {
  let app: ReturnType<typeof buildApp>;
  const headers = { "x-api-key": "test-key" };

  beforeEach(() => {
    app = buildApp(testDatabase(), "test-key");
  });

  const clinicalVitalsForm: FormDefinition = {
    code: "clinical_vitals_intake",
    version: 1,
    title: "Clinical Patient Vitals and Triage Form",
    description: "Configurable patient observations intake with conditional escalation rules",
    fields: [
      {
        key: "patient_id",
        label: "Patient Identifier",
        type: "text",
        required: true,
        pattern: "^PAT-[0-9]{4,6}$"
      },
      {
        key: "systolic_bp",
        label: "Systolic Blood Pressure",
        type: "number",
        required: true,
        min: 60,
        max: 260,
        unit: "mmHg"
      },
      {
        key: "diastolic_bp",
        label: "Diastolic Blood Pressure",
        type: "number",
        required: true,
        min: 40,
        max: 160,
        unit: "mmHg"
      },
      {
        key: "hypertensive_alert",
        label: "Hypertension Triage Flag",
        type: "boolean",
        condition: {
          targetField: "systolic_bp",
          operator: "greater_than",
          value: 140
        }
      },
      {
        key: "emergency_symptoms",
        label: "Escalation Symptoms",
        type: "multiselect",
        options: ["chest_pain", "shortness_of_breath", "vision_blur", "dizziness"],
        condition: {
          targetField: "hypertensive_alert",
          operator: "equals",
          value: true
        }
      },
      {
        key: "triage_status",
        label: "Clinical Triage Level",
        type: "select",
        required: true,
        options: ["routine", "urgent", "resuscitation"]
      }
    ]
  };

  it("registers a configurable form definition via API", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/forms",
      headers,
      payload: clinicalVitalsForm
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe("clinical_vitals_intake");
    expect(body.version).toBe(1);
    expect(body.fieldsCount).toBe(6);
  });

  it("retrieves the registered form definition", async () => {
    await app.inject({
      method: "POST",
      url: "/forms",
      headers,
      payload: clinicalVitalsForm
    });

    const getRes = await app.inject({
      method: "GET",
      url: "/forms/clinical_vitals_intake",
      headers
    });
    expect(getRes.statusCode).toBe(200);
    const def = getRes.json();
    expect(def.title).toBe("Clinical Patient Vitals and Triage Form");
    expect(def.fields).toHaveLength(6);
  });

  it("rejects duplicate field keys in form schema", async () => {
    const invalidForm = {
      code: "invalid_dup_form",
      title: "Duplicate field form",
      fields: [
        { key: "temp", label: "Temperature", type: "number" },
        { key: "temp", label: "Temperature Repeat", type: "number" }
      ]
    };
    const res = await app.inject({
      method: "POST",
      url: "/forms",
      headers,
      payload: invalidForm
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain("Duplicate field key 'temp'");
  });

  it("evaluates and validates valid patient vitals without conditional escalation", async () => {
    await app.inject({
      method: "POST",
      url: "/forms",
      headers,
      payload: clinicalVitalsForm
    });

    const payload = {
      values: {
        patient_id: "PAT-10492",
        systolic_bp: 120,
        diastolic_bp: 80,
        triage_status: "routine"
      }
    };

    const res = await app.inject({
      method: "POST",
      url: "/forms/clinical_vitals_intake/validate",
      headers,
      payload
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.errors).toHaveLength(0);
    expect(body.activeFields).not.toContain("hypertensive_alert");
    expect(body.activeFields).not.toContain("emergency_symptoms");
    expect(body.values.patient_id).toBe("PAT-10492");
    expect(body.values.systolic_bp).toBe(120);
  });

  it("dynamically activates conditional fields when hypertensive threshold is met", async () => {
    await app.inject({
      method: "POST",
      url: "/forms",
      headers,
      payload: clinicalVitalsForm
    });

    const payload = {
      values: {
        patient_id: "PAT-88231",
        systolic_bp: 165,
        diastolic_bp: 98,
        hypertensive_alert: true,
        emergency_symptoms: ["chest_pain", "dizziness"],
        triage_status: "urgent"
      }
    };

    const res = await app.inject({
      method: "POST",
      url: "/forms/clinical_vitals_intake/validate",
      headers,
      payload
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.errors).toHaveLength(0);
    expect(body.activeFields).toContain("hypertensive_alert");
    expect(body.activeFields).toContain("emergency_symptoms");
    expect(body.values.emergency_symptoms).toEqual(["chest_pain", "dizziness"]);
  });

  it("flags validation errors for out-of-bounds metrics and pattern mismatch", async () => {
    await app.inject({
      method: "POST",
      url: "/forms",
      headers,
      payload: clinicalVitalsForm
    });

    const payload = {
      values: {
        patient_id: "INVALID_FORMAT",
        systolic_bp: 320, // max is 260
        diastolic_bp: 30,  // min is 40
        triage_status: "unknown_level" // invalid enum
      }
    };

    const res = await app.inject({
      method: "POST",
      url: "/forms/clinical_vitals_intake/validate",
      headers,
      payload
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThanOrEqual(4);

    const rules = body.errors.map((e: { rule: string }) => e.rule);
    expect(rules).toContain("pattern");
    expect(rules).toContain("max");
    expect(rules).toContain("min");
    expect(rules).toContain("options");
  });
});
