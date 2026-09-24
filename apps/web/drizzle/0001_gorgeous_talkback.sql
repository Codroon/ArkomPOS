CREATE TABLE "account_members" (
	"account_id" text NOT NULL,
	"auth_user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_members_account_id_auth_user_id_pk" PRIMARY KEY("account_id","auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "licence_state" text DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_members_user" ON "account_members" USING btree ("auth_user_id");