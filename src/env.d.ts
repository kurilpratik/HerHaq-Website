/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    /**
     * Set by src/middleware.ts once a request has cleared the admin gate.
     * Present on every page and route under /admin and /api/admin; absent
     * everywhere else, which is why it is optional.
     */
    admin?: {
      email: string;
      name: string | null;
    };
  }
}
