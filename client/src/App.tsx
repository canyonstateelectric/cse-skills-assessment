import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import LoginPage from "./pages/login";
import TestPage from "./pages/test";
import ResultsPage from "./pages/results";
import AdminPage from "./pages/admin";
import NotFound from "./pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/test/:sessionId" component={TestPage} />
      <Route path="/results/:sessionId" component={ResultsPage} />
      <Route path="/admin" component={AdminPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AppRouter />
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
