"use server";

import { revalidatePath } from "next/cache";
import { getDesk } from "./lib/desk";

/** Server actions for the money gate (plan §9): a human tap approves or passes an opportunity. */
export async function approveOpportunity(id: string): Promise<void> {
  const { desk } = await getDesk();
  await desk.approve(id);
  revalidatePath("/");
  revalidatePath(`/deal/${id}`);
}

export async function rejectOpportunity(id: string): Promise<void> {
  const { desk } = await getDesk();
  await desk.reject(id);
  revalidatePath("/");
  revalidatePath(`/deal/${id}`);
}
