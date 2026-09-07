import { createContext, useContext, useState, createElement } from "react";
import type { ReactNode } from "react";

export type StageStatus =
  | "not_started"
  | "source_selected"
  | "files_uploaded"
  | "parsed"
  | "fields_confirmed"
  | "template_selected"
  | "generating"
  | "generated"
  | "finalized";

export interface StageState {
  status: StageStatus;
  sourceType?: "platform" | "upload";
  selectedTemplate?: string;
  selectedTemplateName?: string;
  version?: string;
  finalizedAt?: string;
}

export interface MockState {
  requirement: StageState;
  feasibility: StageState;
  tender: StageState;
  contract: StageState;
}

interface MockStoreCtx {
  state: MockState;
  advanceStage: (stage: keyof MockState, status: StageStatus) => void;
  setSourceType: (stage: keyof MockState, type: "platform" | "upload") => void;
  setTemplate: (stage: keyof MockState, id: string, name: string) => void;
  finalizeStage: (stage: keyof MockState, version: string) => void;
  setGenerating: (stage: keyof MockState) => void;
}

const DEFAULT: MockState = {
  requirement: {
    status: "finalized",
    version: "项目建议书 V2.0",
    finalizedAt: "2026-09-05 09:30",
  },
  feasibility: { status: "fields_confirmed", version: "可行性研究报告 V1.3" },
  tender: { status: "not_started" },
  contract: { status: "not_started" },
};

export const MockStoreContext = createContext<MockStoreCtx>({
  state: DEFAULT,
  advanceStage: () => {},
  setSourceType: () => {},
  setTemplate: () => {},
  finalizeStage: () => {},
  setGenerating: () => {},
});

export function MockStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MockState>(DEFAULT);

  const advanceStage = (stage: keyof MockState, status: StageStatus) =>
    setState((s) => ({ ...s, [stage]: { ...s[stage], status } }));

  const setSourceType = (stage: keyof MockState, type: "platform" | "upload") =>
    setState((s) => ({
      ...s,
      [stage]: {
        ...s[stage],
        sourceType: type,
        status: "source_selected" as StageStatus,
      },
    }));

  const setTemplate = (stage: keyof MockState, id: string, name: string) =>
    setState((s) => ({
      ...s,
      [stage]: {
        ...s[stage],
        selectedTemplate: id,
        selectedTemplateName: name,
        status: "template_selected" as StageStatus,
      },
    }));

  const setGenerating = (stage: keyof MockState) =>
    setState((s) => ({
      ...s,
      [stage]: { ...s[stage], status: "generating" as StageStatus },
    }));

  const finalizeStage = (stage: keyof MockState, version: string) => {
    const now = new Date();
    const ts =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0") +
      " " +
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0");
    setState((s) => ({
      ...s,
      [stage]: {
        ...s[stage],
        status: "finalized" as StageStatus,
        version,
        finalizedAt: ts,
      },
    }));
  };

  return createElement(
    MockStoreContext.Provider,
    {
      value: {
        state,
        advanceStage,
        setSourceType,
        setTemplate,
        finalizeStage,
        setGenerating,
      },
    },
    children,
  );
}

export const useMockStore = () => useContext(MockStoreContext);
