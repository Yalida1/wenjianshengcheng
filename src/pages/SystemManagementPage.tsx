import { useState } from "react";
import { Badge, Button, Dialog, Drawer, Icon, PageHeader, Search } from "../components/UI";

const users = [
  ["王明远", "wang.mingyuan", "省公司信息技术部", "项目编制人员", "启用", "今天 09:18"],
  ["李梓涵", "li.zihan", "省公司采购管理部", "审核人员", "启用", "昨天 16:05"],
  ["陈昊", "chen.hao", "省公司信息技术部", "模板管理员", "启用", "2026-09-03"],
];
const roles = ["系统管理员", "模板管理员", "项目编制人员", "审核人员", "只读人员"];
const perms = [
  "项目查看",
  "项目创建",
  "文件上传",
  "字段确认",
  "文件生成",
  "文件定稿",
  "模板管理",
  "字段字典管理",
  "用户权限管理",
  "审计日志查看",
];
export function SystemManagementPage() {
  const [tab, setTab] = useState("用户管理");
  const [dialog, setDialog] = useState("");
  const [drawer, setDrawer] = useState("");
  const [userRows, setUserRows] = useState(users);
  return (
    <>
      <PageHeader
        title="系统管理"
        sub="管理平台用户、角色权限和关键操作记录。"
        action={
          tab === "用户管理" ? (
            <Button onClick={() => setDialog("新增用户")}>
              <Icon name="plus" size={17} />
              新增用户
            </Button>
          ) : undefined
        }
      />
      <div className="mt-8 border-b border-slate-200">
        {["用户管理", "角色与权限", "审计日志"].map((x) => (
          <button
            onClick={() => setTab(x)}
            key={x}
            className={`mr-7 border-b-2 px-1 pb-3 text-sm ${
              tab === x
                ? "border-[#2E5495] font-medium text-[#24457C]"
                : "border-transparent text-slate-500"
            }`}
          >
            {x}
          </button>
        ))}
      </div>
      {tab === "用户管理" && <Users rows={userRows} onDrawer={setDrawer} />}{" "}
      {tab === "角色与权限" && <Roles onDrawer={setDrawer} />}{" "}
      {tab === "审计日志" && <Audit onDrawer={setDrawer} />}{" "}
      {dialog && (
        <NewUser
          onClose={() => setDialog("")}
          onSave={() => {
            setUserRows([
              ...userRows,
              ["赵启航", "zhao.qihang", "省公司信息技术部", "只读人员", "启用", "刚刚"],
            ]);
            setDialog("");
          }}
        />
      )}{" "}
      {drawer && (
        <Drawer title={drawer} onClose={() => setDrawer("")}>
          <p className="text-sm leading-6 text-slate-600">
            这里展示该对象的详细配置、权限范围和最近修改记录。
          </p>
          <div className="mt-6 border-t border-slate-100 pt-5 text-[13px] text-slate-500">
            最近更新：2026-09-05 14:20
          </div>
        </Drawer>
      )}
    </>
  );
}
function Users({ onDrawer, rows }: { onDrawer: (x: string) => void; rows: string[][] }) {
  return (
    <>
      <div className="mt-6 flex flex-wrap gap-3">
        <Search placeholder="搜索姓名或账号" />
        <Filter t="所属组织" />
        <Filter t="用户状态" />
        <Filter t="角色" />
      </div>
      <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[1fr_1fr_1.25fr_1fr_.55fr_.9fr_.4fr] gap-4 bg-slate-50 px-6 py-3 text-xs text-slate-500">
          <span>用户姓名</span>
          <span>登录账号</span>
          <span>所属组织</span>
          <span>角色</span>
          <span>状态</span>
          <span>最近登录</span>
          <span>操作</span>
        </div>
        {rows.map((r) => (
          <div
            key={r[1]}
            className="grid min-h-16 grid-cols-[1fr_1fr_1.25fr_1fr_.55fr_.9fr_.4fr] items-center gap-4 border-t border-slate-100 px-6 text-[13px]"
          >
            <button
              onClick={() => onDrawer(r[0])}
              className="text-left font-medium hover:text-[#24457C]"
            >
              {r[0]}
            </button>
            <span>{r[1]}</span>
            <span>{r[2]}</span>
            <span>{r[3]}</span>
            <Badge tone="success">{r[4]}</Badge>
            <span className="text-slate-500">{r[5]}</span>
            <button onClick={() => onDrawer(r[0])} className="text-[#2E5495]">
              查看
            </button>
          </div>
        ))}
      </section>
    </>
  );
}
function Roles({ onDrawer }: { onDrawer: (x: string) => void }) {
  return (
    <div className="mt-6 grid grid-cols-[220px_minmax(0,1fr)] gap-6">
      <aside className="rounded-xl border border-slate-200 bg-white p-3">
        {roles.map((x, i) => (
          <button
            onClick={() => onDrawer(x)}
            key={x}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
              i === 0
                ? "bg-[#F2F6FC] font-medium text-[#24457C]"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {x}
          </button>
        ))}
      </aside>
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="font-semibold text-slate-800">系统管理员权限</h2>
          <p className="mt-1 text-[13px] text-slate-500">可管理平台全局配置与关键操作记录。</p>
        </div>
        <div className="grid grid-cols-2 gap-x-10 px-6 py-3">
          {perms.map((x, i) => (
            <div
              key={x}
              className="flex items-center justify-between border-b border-slate-100 py-3 text-sm"
            >
              <span>{x}</span>
              <Badge tone={i < 5 ? "success" : "info"}>{i < 5 ? "允许" : "按权限"}</Badge>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
function Audit({ onDrawer }: { onDrawer: (x: string) => void }) {
  const rows = [
    ["2026-09-05 14:20", "王明远", "确认字段", "可行性研究报告", "V1.3", "成功"],
    ["2026-09-05 09:42", "李梓涵", "文件定稿", "项目建议书", "V2.0", "成功"],
    ["2026-09-04 16:30", "陈昊", "发布模板", "货物类公开招标文件模板", "V3.0", "成功"],
  ];
  return (
    <>
      <div className="mt-6 flex flex-wrap gap-3">
        <Search placeholder="操作人" />
        <Filter t="操作类型" />
        <Filter t="业务对象" />
        <Filter t="时间范围" />
        <Filter t="操作结果" />
      </div>
      <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.1fr_.7fr_1fr_1.4fr_.6fr_.55fr_.45fr] gap-3 bg-slate-50 px-6 py-3 text-xs text-slate-500">
          <span>操作时间</span>
          <span>操作人</span>
          <span>操作行为</span>
          <span>业务对象</span>
          <span>对象版本</span>
          <span>操作结果</span>
          <span>查看详情</span>
        </div>
        {rows.map((r) => (
          <div
            key={r[0]}
            className="grid min-h-16 grid-cols-[1.1fr_.7fr_1fr_1.4fr_.6fr_.55fr_.45fr] items-center gap-3 border-t border-slate-100 px-6 text-[13px]"
          >
            <span className="text-slate-500">{r[0]}</span>
            <span>{r[1]}</span>
            <span>{r[2]}</span>
            <span>{r[3]}</span>
            <span>{r[4]}</span>
            <Badge tone="success">{r[5]}</Badge>
            <button onClick={() => onDrawer("审计日志详情")} className="text-[#2E5495]">
              查看
            </button>
          </div>
        ))}
      </section>
    </>
  );
}
function Filter({ t }: { t: string }) {
  return (
    <select className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-600">
      <option>{t}</option>
    </select>
  );
}
function NewUser({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  return (
    <Dialog title="新增用户" description="新增用户后可分配平台角色和所属组织。" onClose={onClose}>
      <div className="grid grid-cols-2 gap-5">
        {["用户姓名", "登录账号", "所属组织", "角色"].map((x) => (
          <label key={x} className="text-sm font-medium">
            {x}
            <input
              className="mt-2 h-10 w-full rounded-lg border border-slate-300 px-3"
              placeholder={`输入${x}`}
            />
          </label>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button onClick={onSave}>保存用户</Button>
      </div>
    </Dialog>
  );
}
