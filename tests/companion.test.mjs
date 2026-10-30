import test from "node:test";
import assert from "node:assert/strict";
import { messageBodySchema, emptyBodySchema, writeTools, toolNames } from "../src/lib/companion/validation.ts";
import { persistableCompanionResponse } from "../src/lib/companion/retention.ts";

test("browser chat accepts only a bounded message and request identity",()=>{
  const input={request_id:"00000000-0000-4000-8000-000000000001",message:"  What's my budget?  "};
  assert.equal(messageBodySchema.parse(input).message,"What's my budget?");
  for(const patch of [{trip_id:"foreign"},{context:{}},{tools:[]},{user_id:"foreign"},{arguments:{}}])assert.equal(messageBodySchema.safeParse({...input,...patch}).success,false);
  for(const message of ["", " ", "x".repeat(2001)])assert.equal(messageBodySchema.safeParse({...input,message}).success,false);
});
test("confirmation accepts no browser-authored tool arguments or state",()=>{
  assert.equal(emptyBodySchema.safeParse({}).success,true);
  for(const input of [{arguments:{}},{tool_name:"select_hotel"},{confirmed:true},{payload:"forged"}])assert.equal(emptyBodySchema.safeParse(input).success,false);
  assert.equal(toolNames.length,18);assert.equal(writeTools.size,7);
});

test("durable history preserves supplier retention: live hotel quotes/details and unsaved food do not persist",()=>{
  const response={message:"Transient Hotel costs USD 720",cards:[{tool_name:"get_selected_hotel",data:{selected:true,name:"Transient Hotel",total_price:"720.00",guest_rating:4.6}},{tool_name:"find_food_options",data:{options:[{name:"Unsaved Restaurant"}]}},{tool_name:"get_budget_summary",data:{remaining_budget:"1275.00"}}],tool_audit:[]};
  const retained=persistableCompanionResponse(response),text=JSON.stringify(retained);
  assert.ok(!text.includes("Transient Hotel"));assert.ok(!text.includes("720"));assert.ok(!text.includes("Unsaved Restaurant"));assert.ok(text.includes("1275.00"));
  const omitted=persistableCompanionResponse({...response,cards:[],tool_audit:[{tool_name:"get_selected_hotel",status:"ok"}]});assert.ok(!omitted.message.includes("Transient Hotel"));
  const saved=persistableCompanionResponse({...response,cards:[{tool_name:"get_saved_food",data:{options:[{name:"Saved Cafe",category:"cafe",dietary_tags:["vegan"],distance_km:1}]}}]});
  assert.equal(saved.cards[0].data.options[0].name,"Saved Cafe");assert.equal(saved.cards[0].data.options[0].dietary_tags,undefined);
});
