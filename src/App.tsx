import { useEffect, useState } from "react";
import { Sidebar, Topbar } from "./components/Layout";
import { ProjectDetailPage, ProjectListPage } from "./pages/ProjectPages";
import { FieldDictionaryPage, TemplateCenterPage, TemplateDetailPage } from "./pages/AdminPages";
import { SystemManagementPage } from "./pages/SystemManagementPage";
import { FieldConfirmationPage } from "./pages/FieldConfirmationPage";
import { TemplateSelectionPage } from "./pages/TemplateSelectionPage";
import { GenerationSetupPage } from "./pages/GenerationSetupPage";
import { GenerationProgressPage } from "./pages/GenerationProgressPage";
import { DocumentWorkspacePage } from "./pages/DocumentWorkspacePage";
import { ValidationCenterPage } from "./pages/ValidationCenterPage";
import { DocumentComparePage } from "./pages/DocumentComparePage";
import { ContractSourceSelectionPage } from "./pages/ContractSourceSelectionPage";
import {
  TenderSourceSelectionPage,
  TenderFileUploadPage,
  TenderParseProgressPage,
  TenderParseSummaryPage,
} from "./pages/TenderPrePages";
import {
  RequirementSourceSelectionPage,
  RequirementInputPage,
  RequirementFileUploadPage,
  RequirementFieldConfirmationPage,
  ProposalTemplateSelectionPage,
  ProposalGenerationSetupPage,
  ProposalGenerationProgressPage,
  ProposalDocumentWorkspacePage,
  ProposalValidationPage,
  ProposalFinalizedPage,
} from "./pages/RequirementPages";
import {
  FeasibilitySourceSelectionPage,
  FeasibilityFileUploadPage,
  FeasibilityParseSummaryPage,
  FeasibilityFieldConfirmationPage,
  FeasibilityProfessionSelectionPage,
  FeasibilityTemplateSelectionPage,
  FeasibilityGenerationSetupPage,
  FeasibilityGenerationProgressPage,
  FeasibilityDocumentWorkspacePage,
  FeasibilityValidationPage,
  FeasibilityFinalizedPage,
} from "./pages/FeasibilityPages";
import {
  ContractFileUploadPage,
  ContractParseSummaryPage,
  ContractFieldConfirmationPage,
  ContractElementConfirmationPage,
  ContractTemplateSelectionPage,
  ContractGenerationSetupPage,
  ContractGenerationProgressPage,
  ContractDocumentWorkspacePage,
  ContractValidationPage,
  ContractFinalizedPage,
  ContractExportPage,
} from "./pages/ContractPages";
import { UIStatesPage } from "./pages/UIStatesPage";
import { MockStoreProvider, useMockStore } from "./mock/store";
import type { Page } from "./types";

const ALL_PAGES: Page[] = [
  "project-list","project-detail","template-center","template-detail","field-dictionary","system-management",
  "field-confirmation","template-selection","generation-setup","generation-progress","document-preview","validation-center","document-compare",
  "tender-source-selection","tender-file-upload","tender-parse-progress","tender-parse-summary",
  "contract-source","contract-file-upload","contract-parse-summary","contract-field-confirmation","contract-element-confirmation",
  "contract-template-selection","contract-generation-setup","contract-generation-progress",
  "contract-document-workspace","contract-validation","contract-finalized","contract-export",
  "requirement-source-selection","requirement-input","requirement-file-upload","requirement-field-confirmation",
  "proposal-template-selection","proposal-generation-setup","proposal-generation-progress",
  "proposal-document-workspace","proposal-validation","proposal-finalized",
  "feasibility-source-selection","feasibility-file-upload","feasibility-parse-summary",
  "feasibility-field-confirmation","feasibility-profession-selection","feasibility-template-selection",
  "feasibility-generation-setup","feasibility-generation-progress","feasibility-document-workspace",
  "feasibility-validation","feasibility-finalized",
  "ui-states",
];

const IMMERSIVE: Page[] = [
  "field-confirmation","template-selection","generation-setup","generation-progress","document-preview","validation-center","document-compare",
  "tender-source-selection","tender-file-upload","tender-parse-progress","tender-parse-summary",
  "contract-source","contract-file-upload","contract-parse-summary","contract-field-confirmation","contract-element-confirmation",
  "contract-template-selection","contract-generation-setup","contract-generation-progress",
  "contract-document-workspace","contract-validation","contract-finalized","contract-export",
  "requirement-source-selection","requirement-input","requirement-file-upload","requirement-field-confirmation",
  "proposal-template-selection","proposal-generation-setup","proposal-generation-progress",
  "proposal-document-workspace","proposal-validation","proposal-finalized",
  "feasibility-source-selection","feasibility-file-upload","feasibility-parse-summary",
  "feasibility-field-confirmation","feasibility-profession-selection","feasibility-template-selection",
  "feasibility-generation-setup","feasibility-generation-progress","feasibility-document-workspace",
  "feasibility-validation","feasibility-finalized",
];

const decode = (): Page => { const x = location.hash.slice(1) as Page; return ALL_PAGES.includes(x) ? x : "project-list"; };

function AppInner() {
  const [page, setPage] = useState<Page>(decode);
  const [compact, setCompact] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [generationRunning, setGenerationRunning] = useState(false);
  const [tenderFinalized, setTenderFinalized] = useState(false);
  const store = useMockStore();

  const navigate = (next: Page) => { location.hash = next; setPage(next); window.scrollTo(0, 0); };
  useEffect(() => { const h = () => setPage(decode()); addEventListener("hashchange", h); return () => removeEventListener("hashchange", h); }, []);

  const isImmersive = IMMERSIVE.includes(page);

  const pages: Record<Page, React.ReactNode> = {
    "project-list": <ProjectListPage navigate={navigate}/>,
    "project-detail": <ProjectDetailPage navigate={navigate} generationRunning={generationRunning} tenderFinalized={tenderFinalized}/>,
    "template-center": <TemplateCenterPage navigate={navigate}/>,
    "template-detail": <TemplateDetailPage navigate={navigate}/>,
    "field-dictionary": <FieldDictionaryPage/>,
    "system-management": <SystemManagementPage/>,
    "field-confirmation": <FieldConfirmationPage navigate={navigate}/>,
    "template-selection": <TemplateSelectionPage navigate={navigate} onNext={(id)=>setSelectedTemplateId(id)}/>,
    "generation-setup": <GenerationSetupPage navigate={navigate} onConfirmGenerate={()=>setGenerationRunning(true)}/>,
    "generation-progress": <GenerationProgressPage navigate={navigate} onBgRun={()=>setGenerationRunning(true)}/>,
    "document-preview": <DocumentWorkspacePage navigate={navigate} onFinalized={()=>{ setTenderFinalized(true); setGenerationRunning(false); store.finalizeStage("tender","招标文件 V1.0"); }}/>,
    "validation-center": <ValidationCenterPage navigate={navigate}/>,
    "document-compare": <DocumentComparePage navigate={navigate}/>,
    "tender-source-selection": <TenderSourceSelectionPage navigate={navigate}/>,
    "tender-file-upload": <TenderFileUploadPage navigate={navigate}/>,
    "tender-parse-progress": <TenderParseProgressPage navigate={navigate}/>,
    "tender-parse-summary": <TenderParseSummaryPage navigate={navigate}/>,
    "contract-source": <ContractSourceSelectionPage navigate={navigate}/>,
    "contract-file-upload": <ContractFileUploadPage navigate={navigate}/>,
    "contract-parse-summary": <ContractParseSummaryPage navigate={navigate}/>,
    "contract-field-confirmation": <ContractFieldConfirmationPage navigate={navigate}/>,
    "contract-element-confirmation": <ContractElementConfirmationPage navigate={navigate}/>,
    "contract-template-selection": <ContractTemplateSelectionPage navigate={navigate}/>,
    "contract-generation-setup": <ContractGenerationSetupPage navigate={navigate}/>,
    "contract-generation-progress": <ContractGenerationProgressPage navigate={navigate}/>,
    "contract-document-workspace": <ContractDocumentWorkspacePage navigate={navigate}/>,
    "contract-validation": <ContractValidationPage navigate={navigate}/>,
    "contract-finalized": <ContractFinalizedPage navigate={navigate}/>,
    "contract-export": <ContractExportPage navigate={navigate}/>,
    "requirement-source-selection": <RequirementSourceSelectionPage navigate={navigate}/>,
    "requirement-input": <RequirementInputPage navigate={navigate}/>,
    "requirement-file-upload": <RequirementFileUploadPage navigate={navigate}/>,
    "requirement-field-confirmation": <RequirementFieldConfirmationPage navigate={navigate}/>,
    "proposal-template-selection": <ProposalTemplateSelectionPage navigate={navigate}/>,
    "proposal-generation-setup": <ProposalGenerationSetupPage navigate={navigate}/>,
    "proposal-generation-progress": <ProposalGenerationProgressPage navigate={navigate}/>,
    "proposal-document-workspace": <ProposalDocumentWorkspacePage navigate={navigate}/>,
    "proposal-validation": <ProposalValidationPage navigate={navigate}/>,
    "proposal-finalized": <ProposalFinalizedPage navigate={navigate}/>,
    "feasibility-source-selection": <FeasibilitySourceSelectionPage navigate={navigate}/>,
    "feasibility-file-upload": <FeasibilityFileUploadPage navigate={navigate}/>,
    "feasibility-parse-summary": <FeasibilityParseSummaryPage navigate={navigate}/>,
    "feasibility-field-confirmation": <FeasibilityFieldConfirmationPage navigate={navigate}/>,
    "feasibility-profession-selection": <FeasibilityProfessionSelectionPage navigate={navigate}/>,
    "feasibility-template-selection": <FeasibilityTemplateSelectionPage navigate={navigate}/>,
    "feasibility-generation-setup": <FeasibilityGenerationSetupPage navigate={navigate}/>,
    "feasibility-generation-progress": <FeasibilityGenerationProgressPage navigate={navigate}/>,
    "feasibility-document-workspace": <FeasibilityDocumentWorkspacePage navigate={navigate}/>,
    "feasibility-validation": <FeasibilityValidationPage navigate={navigate}/>,
    "feasibility-finalized": <FeasibilityFinalizedPage navigate={navigate}/>,
    "ui-states": <UIStatesPage/>,
  };

  return (
    <div className="flex h-full overflow-hidden bg-[#F6F8FB] text-slate-700">
      <Sidebar page={page} navigate={navigate} compact={compact} setCompact={setCompact}/>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!isImmersive && <Topbar page={page} navigate={navigate}/>}
        <main className={`min-w-0 flex-1 ${isImmersive ? "overflow-hidden flex flex-col" : "overflow-auto px-4 py-6 sm:px-6 sm:py-8 xl:px-8"}`}>
          {isImmersive
            ? pages[page]
            : <div className="mx-auto max-w-[1600px]">{pages[page]}</div>
          }
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <MockStoreProvider>
      <AppInner/>
    </MockStoreProvider>
  );
}
