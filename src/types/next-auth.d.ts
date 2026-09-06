import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user?: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: string;
      roleTitle?: string | null;
      jobTitle?: string | null;
      skill?: string | null;
      lob?: string | null;
      mustChangePassword?: boolean;
    };
  }

  interface User {
    role?: string;
    roleTitle?: string | null;
    jobTitle?: string | null;
    skill?: string | null;
    lob?: string | null;
    mustChangePassword?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    authVersion?: string;
    authInvalid?: boolean;
    demoSession?: boolean;
    role?: string;
    roleTitle?: string | null;
    jobTitle?: string | null;
    skill?: string | null;
    lob?: string | null;
    mustChangePassword?: boolean;
  }
}
