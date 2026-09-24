CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"terminal_id" text NOT NULL,
	"terminal_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"app_version" text NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_acked_seq" bigint DEFAULT 0 NOT NULL,
	"last_push_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "enrol_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_device_id" text
);
--> statement-breakpoint
CREATE TABLE "sync_entries" (
	"tenant_id" text NOT NULL,
	"op_id" text NOT NULL,
	"device_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"location_id" text NOT NULL,
	"terminal_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"user_id" text,
	"authorized_by_user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_entries_tenant_id_op_id_pk" PRIMARY KEY("tenant_id","op_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrol_codes" ADD CONSTRAINT "enrol_codes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrol_codes" ADD CONSTRAINT "enrol_codes_used_by_device_id_devices_id_fk" FOREIGN KEY ("used_by_device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_entries" ADD CONSTRAINT "sync_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_entries" ADD CONSTRAINT "sync_entries_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_accounts_email" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_devices_token" ON "devices" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_devices_terminal" ON "devices" USING btree ("tenant_id","terminal_id");--> statement-breakpoint
CREATE INDEX "ix_devices_account" ON "devices" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_enrol_codes_hash" ON "enrol_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "ix_enrol_codes_account" ON "enrol_codes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ix_entries_stream" ON "sync_entries" USING btree ("tenant_id","device_id","seq");--> statement-breakpoint
CREATE INDEX "ix_entries_entity" ON "sync_entries" USING btree ("tenant_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "ix_entries_when" ON "sync_entries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_tenants_account" ON "tenants" USING btree ("account_id");