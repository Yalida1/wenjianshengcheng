import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "./Shell";
import {
  DISPLAY_PRESETS,
  LIFECYCLE_KEYS,
  PROJECT_LIFECYCLE,
  type DisplayPresetId,
  type LifecycleStageKey,
  type StageDisplayPreference,
  loadDefaultStageDisplay,
  matchPreset,
  preferenceFromPreset,
  saveDefaultStageDisplay,
} from "./projectLifecycle";

export function StageDisplaySettingsPage() {
  const [preference, setPreference] = useState<StageDisplayPreference>(() => loadDefaultStageDisplay());
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const selected = useMemo(() => new Set(preference.keys), [preference.keys]);

  function applyPreset(preset: Exclude<DisplayPresetId, "custom">) {
    setPreference(preferenceFromPreset(preset));
    setSavedAt(null);
  }

  function toggleKey(key: LifecycleStageKey) {
    const next = new Set(selected);
    if (next.has(key)) {
      if (next.size === 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    const keys = LIFECYCLE_KEYS.filter((item) => next.has(item));
    setPreference({ preset: matchPreset(keys), keys });
    setSavedAt(null);
  }

  function save() {
    const payload: StageDisplayPreference = {
      preset: matchPreset(preference.keys),
      keys: preference.keys,
    };
    saveDefaultStageDisplay(payload);
    setPreference(payload);
    setSavedAt(new Date().toLocaleString("zh-CN"));
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="mb-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">阶段展示</div>
            <h3 className="mt-1 section-title">常态展示范围</h3>
            <p className="section-description">
              设置项目概览默认可见的生命周期阶段。成员仍可在单个项目中临时调整。
            </p>
          </div>
          <button type="button" className="primary-button shrink-0" onClick={save}>
            保存为常态默认
          </button>
        </div>

        <h4 className="mt-5 text-sm font-semibold text-slate-800">快捷方案</h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.entries(DISPLAY_PRESETS) as Array<
            [Exclude<DisplayPresetId, "custom">, (typeof DISPLAY_PRESETS)[Exclude<DisplayPresetId, "custom">]]
          >).map(([id, preset]) => {
            const active = preference.preset === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => applyPreset(id)}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  active
                    ? "border-[#155AA8] bg-blue-50/70 ring-1 ring-[#155AA8]/30"
                    : "border-slate-200 hover:border-blue-200 hover:bg-slate-50"
                }`}
              >
                <div className="font-medium text-slate-900">{preset.label}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{preset.hint}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="section-title">勾选可见阶段</h3>
            <p className="section-description">按项目推进顺序勾选；至少保留一个阶段。</p>
          </div>
          {savedAt && <div className="text-xs text-emerald-700">已保存 · {savedAt}</div>}
        </div>
        <ol className="space-y-2">
          {PROJECT_LIFECYCLE.map((stage, index) => {
            const checked = selected.has(stage.key);
            return (
              <li key={stage.key}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${
                    checked ? "border-blue-200 bg-blue-50/40" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    onChange={() => toggleKey(stage.key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                        {index + 1}
                      </span>
                      <strong className="font-medium text-slate-900">{stage.name}</strong>
                      {!stage.backendKey && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                          流程占位
                        </span>
                      )}
                      {stage.role === "tender_basis" && stage.backendKey && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-[#155AA8]">
                          上传解析
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500">{stage.detail}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="primary-button" onClick={save}>
            保存设置
          </button>
          <Link className="secondary-button" to="/projects?kind=managed">
            返回项目空间
          </Link>
        </div>
      </Card>
    </div>
  );
}
