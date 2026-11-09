import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_GOALS, type Goals } from "../../shared/goals";
import { useGoals } from "./useGoals";

interface GoalsCtx {
  goals: Goals;
  /** False until the user saves goals (first run). */
  saved: boolean;
  save: (g: Partial<Goals>) => Promise<Goals>;
  /** Re-read goals (e.g. after settings arrive from Drive). */
  reload: () => Promise<void>;
}
const Ctx = createContext<GoalsCtx>({ goals: DEFAULT_GOALS, saved: true, save: async () => DEFAULT_GOALS, reload: async () => {} });

/** One goals source for every dashboard view, so an inline edit updates all charts at once. */
export function GoalsProvider({ children }: { children: ReactNode }) {
  const { goals, saved, save, reload } = useGoals();
  return <Ctx.Provider value={{ goals, saved, save, reload }}>{children}</Ctx.Provider>;
}
export const useGoalsContext = () => useContext(Ctx);
