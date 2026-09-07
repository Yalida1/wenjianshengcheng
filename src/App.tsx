import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminErrorBoundary } from "./app/AdminErrorBoundary";
import { FieldDictionaryPage, SystemPage, TemplateAdminPage } from "./app/AdminPages";
import { AuthProvider, LoginPage, ProtectedRoute } from "./app/Auth";
import { DocumentPage } from "./app/DocumentPage";
import { ProjectOverviewPage, ProjectsPage } from "./app/ProjectPages";
import { Shell } from "./app/Shell";
import { StagePage } from "./app/StagePage";
import { UIStatesPage } from "./app/UIStatesPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
                <Route index element={<Navigate to="/projects" replace />} />
                <Route path="projects" element={<ProjectsPage />} />
                <Route path="projects/:projectId" element={<ProjectOverviewPage />} />
                <Route
                  path="projects/:projectId/stages/:stage"
                  element={<Navigate to="source" replace />}
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
                <Route path="system/users" element={<Navigate to="/admin/users" replace />} />
                <Route path="system/roles" element={<Navigate to="/admin/roles" replace />} />
                <Route
                  path="system/audit-logs"
                  element={<Navigate to="/admin/audit-logs" replace />}
                />
                {import.meta.env.DEV && <Route path="ui-states" element={<UIStatesPage />} />}
              </Route>
              <Route path="*" element={<Navigate to="/projects" replace />} />
            </Routes>
          </AdminErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
