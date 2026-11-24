"use client";
import React from "react";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Image from "next/image";
import { StatusBadge } from "../StatusBadge";
import { capitalize } from "es-toolkit";
import Link from "next/link";
import { FiEdit, FiMapPin, FiTrash } from "react-icons/fi";
import { Button, buttonVariants } from "@/components/ui/button";
import { PetSummary } from "@/server/types";

export default function PetCard({ pet }: { pet: PetSummary }) {
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
          <FiEdit className="h-4 w-4" />
          Edit
        </Link>
        <Button variant="destructive" className="cursor-pointer">
          <FiTrash className="h-4 w-4" />
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
}
