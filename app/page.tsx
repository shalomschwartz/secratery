import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { SignIn } from "@/components/SignIn";
import { ChatInterface } from "@/components/ChatInterface";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return <SignIn />;
  }

  if (session.error === "RefreshAccessTokenError") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f1117]">
        <div className="max-w-sm text-center">
          <p className="text-slate-300 mb-4">
            Your session has expired. Please sign in again.
          </p>
          <SignIn />
        </div>
      </div>
    );
  }

  return <ChatInterface userEmail={session.user?.email ?? undefined} />;
}
