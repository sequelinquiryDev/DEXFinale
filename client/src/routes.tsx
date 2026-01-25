import { Route } from 'wouter';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/not-found';

export const routes = (
    <>
        <Route path="/" component={Dashboard} />
        <Route component={NotFound} />
    </>
);
