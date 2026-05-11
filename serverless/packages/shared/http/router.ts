import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ApiResponse, AuthUser } from '../types';
import { toErrorResponse } from '../errors';
import { error } from './response';

type RouteHandler = (
  event: APIGatewayProxyEventV2,
  user: AuthUser,
) => Promise<ApiResponse>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

function pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = path.replace(/:([a-zA-Z_]+)/g, (_match, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${regexStr}$`), paramNames };
}

export function createRouter() {
  const routes: Route[] = [];

  function addRoute(method: string, path: string, handler: RouteHandler) {
    const { pattern, paramNames } = pathToRegex(path);
    routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
  }

  function resolve(event: APIGatewayProxyEventV2, user: AuthUser): Promise<ApiResponse> {
    const method = event.requestContext.http.method.toUpperCase();
    const path = event.rawPath;

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (!match) continue;

      if (!event.pathParameters) event.pathParameters = {};
      route.paramNames.forEach((name, i) => {
        event.pathParameters![name] = decodeURIComponent(match[i + 1]);
      });

      return route.handler(event, user).catch((err) => {
        const errRes = toErrorResponse(err, `${method} ${path}`);
        return error(errRes.statusCode, errRes.body);
      });
    }

    return Promise.resolve(
      error(404, { error: `Route not found: ${method} ${path}` }),
    );
  }

  return {
    get: (path: string, handler: RouteHandler) => addRoute('GET', path, handler),
    post: (path: string, handler: RouteHandler) => addRoute('POST', path, handler),
    put: (path: string, handler: RouteHandler) => addRoute('PUT', path, handler),
    delete: (path: string, handler: RouteHandler) => addRoute('DELETE', path, handler),
    patch: (path: string, handler: RouteHandler) => addRoute('PATCH', path, handler),
    resolve,
  };
}
