import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_GOALS, type Goals } from "../../shared/goals";
import { useGoals } from "./useGoals";

interface GoalsCtx {
  goals: Goals;
  save: (g: Partial<Goals>) => Promise<Goals>;
}
const Ctx = createContext<GoalsCtx>({ goals: DEFAULT_GOALS, save: async () => DEFAULT_GOALS });

/** One goals source for every dashboard view, so an inline edit updates all charts at once. */
export function GoalsProvider({ children }: { children: ReactNode }) {
  const { goals, save } = useGoals();
  return <Ctx.Provider value={{ goals, save }}>{children}</Ctx.Provider>;
}
export const useGoalsContext = () => useContext(Ctx);
