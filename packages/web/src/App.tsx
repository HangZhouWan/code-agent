/**
 * 根组件 App
 *
 * 通用 AI Agent 平台的主界面入口
 */
export function App() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <header className="text-center">
        <h1 className="text-4xl font-bold text-gray-900">My Agent</h1>
        <p className="mt-3 text-lg text-gray-600">通用 AI Agent 平台</p>
      </header>
      <main className="mt-10">
        <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <p className="text-gray-500">🚀 项目已启动</p>
          <p className="mt-2 text-sm text-gray-400">后续步骤将实现完整的 Agent 对话界面</p>
        </div>
      </main>
    </div>
  );
}