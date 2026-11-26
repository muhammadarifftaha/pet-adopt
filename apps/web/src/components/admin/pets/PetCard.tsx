"use client";
import React from "react";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@pet-adopt/ui/components/card";
import Image from "next/image";
import { StatusBadge } from "../StatusBadge";
import { capitalize } from "es-toolkit";
import Link from "next/link";
import { FiEdit, FiEye, FiMapPin, FiTrash } from "react-icons/fi";
import { useViewOnly } from "@/components/admin/view-only";
import { Button, buttonVariants } from "@pet-adopt/ui/components/button";
import { PetSummary } from "@/server/types";

export default function PetCard({ pet }: { pet: PetSummary }) {
  // Roles that can view pets but not change them (audit) get View, and no Delete.
  const viewOnly = useViewOnly();
  return (
    <Card key={pet.id} className="relative mx-auto w-full pt-0">
      <Image
        src={pet.photos[0]?.thumbnailUrl || "/images/placeholder.png"}
        alt="Event cover"
        width={640}
        height={360}
        className="relative z-20 aspect-video w-full object-cover "
      />
      <CardHeader className="relative z-40 flex-auto">
        <CardTitle className="text-lg font-semibold">{pet.name}</CardTitle>
        <CardAction>
          <StatusBadge status={capitalize(pet.status)} />
        </CardAction>

        <CardDescription className="text-sm text-muted-foreground">
          {capitalize(pet.species)} • {capitalize(pet.sex ?? "Unknown")} •{" "}
          {pet.ageDescription}
        </CardDescription>
        <CardDescription className="text-sm text-muted-foreground items-center flex">
          <FiMapPin className="mr-1 inline h-4 w-4" />
          {pet.location}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex justify-end gap-2">
        <Link
          href={`/admin/pets/${pet.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          {viewOnly ? <FiEye className="h-4 w-4" aria-hidden /> : <FiEdit className="h-4 w-4" aria-hidden />}
          {viewOnly ? "View" : "Edit"}
          <span className="sr-only">{pet.name}</span>
        </Link>
        {viewOnly ? null : (
          <Button variant="destructive" className="cursor-pointer">
            <FiTrash className="h-4 w-4" aria-hidden />
            Delete
            <span className="sr-only">{pet.name}</span>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
