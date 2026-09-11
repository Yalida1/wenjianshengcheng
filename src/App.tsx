import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { AdminErrorBoundary } from "./app/AdminErrorBoundary";
import { FieldDictionaryPage, SystemPage, TemplateAdminPage } from "./app/AdminPages";
import { AuthProvider, LoginPage, ProtectedRoute } from "./app/Auth";
import { BrandingProvider } from "./config/BrandingProvider";
import { DocumentPage } from "./app/DocumentPage";
import { ProjectFormConfigPage } from "./app/ProjectFormConfigPage";
import { ApprovalRequestsPage } from "./app/ApprovalRequestsPage";
import { ProjectOverviewPage, ProjectsPage } from "./app/ProjectPages";
import { Shell } from "./app/Shell";
import { StageDisplaySettingsPage } from "./app/StageDisplaySettingsPage";
import { StagePage } from "./app/StagePage";
import { UIStatesPage } from "./app/UIStatesPage";
import { WorkbenchPage } from "./app/WorkbenchPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

function StageIndexRedirect() {
  const { stage = "tender" } = useParams();
  if (stage === "tender") return <Navigate to="basics" replace />;
  if (stage === "demand" || stage === "requirement" || stage === "feasibility") {
    return <Navigate to="files" replace />;
  }
  return <Navigate to="source" replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <BrandingProvider>
          <AuthProvider>
            <AdminErrorBoundary>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  element={
                    <ProtectedRoute>
                      <Shell />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Navigate to="/workbench" replace />} />
                  <Route path="workbench" element={<WorkbenchPage />} />
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route path="projects/:projectId" element={<ProjectOverviewPage />} />
                  <Route
                    path="projects/:projectId/stages/:stage"
                    element={<StageIndexRedirect />}
                  />
                  <Route path="projects/:projectId/stages/:stage/:tab" element={<StagePage />} />
                  <Route
                    path="projects/:projectId/documents/:documentId"
                    element={<DocumentPage />}
                  />
                  <Route
                    path="projects/:projectId/documents/:documentId/validation"
                    element={<DocumentPage />}
                  />
                  <Route
                    path="projects/:projectId/documents/:documentId/compare"
                    element={<DocumentPage />}
                  />
                  <Route path="templates" element={<TemplateAdminPage />} />
                  <Route path="templates/:templateId" element={<TemplateAdminPage />} />
                  <Route path="field-dictionary" element={<FieldDictionaryPage />} />
                  <Route path="admin/users" element={<SystemPage />} />
                  <Route path="admin/roles" element={<SystemPage />} />
                  <Route path="admin/audit-logs" element={<SystemPage />} />
                  <Route path="admin/project-form" element={<ProjectFormConfigPage />} />
                  <Route path="admin/approvals" element={<ApprovalRequestsPage />} />
                  <Route path="admin/stage-display" element={<StageDisplaySettingsPage />} />
                  <Route path="admin/branding" element={<SystemPage />} />
                  <Route path="admin/models" element={<SystemPage />} />
                  <Route path="system/users" element={<Navigate to="/admin/users" replace />} />
                  <Route path="system/roles" element={<Navigate to="/admin/roles" replace />} />
                  <Route
                    path="system/audit-logs"
                    element={<Navigate to="/admin/audit-logs" replace />}
                  />
                  <Route
                    path="system/project-form"
                    element={<Navigate to="/admin/project-form" replace />}
                  />
                  <Route
                    path="system/approvals"
                    element={<Navigate to="/admin/approvals" replace />}
                  />
                  <Route
                    path="system/stage-display"
                    element={<Navigate to="/admin/stage-display" replace />}
                  />
                  <Route path="system/branding" element={<Navigate to="/admin/branding" replace />} />
                  {import.meta.env.DEV && <Route path="ui-states" element={<UIStatesPage />} />}
                </Route>
                <Route path="*" element={<Navigate to="/workbench" replace />} />
              </Routes>
            </AdminErrorBoundary>
          </AuthProvider>
        </BrandingProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
