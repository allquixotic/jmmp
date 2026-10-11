<!-- Copyright 2026 Sean McNamara; SPDX-License-Identifier: Apache-2.0 -->
<template>
  <q-dialog v-model="model">
    <q-card style="width: 560px; max-width: 95vw">
      <q-card-section><div class="text-h6">Add Spotify</div></q-card-section>
      <q-card-section class="q-gutter-md">
        <p>Connect a Spotify Premium account. Create an application in the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify dashboard</a> and register this redirect URI:</p>
        <q-input :model-value="redirectUri" readonly label="Redirect URI" />
        <q-input v-model="name" label="Source name" :disable="!!state" />
        <q-input v-model="clientId" label="Spotify application client ID" :disable="!!state" />
        <q-input v-model="links" type="textarea" label="Track, album or playlist links (one per line)" :disable="!!state" />
        <q-banner v-if="error" class="bg-red-1 text-red-10">{{ error }}</q-banner>
        <p v-if="state">Finish signing in to Spotify, then return here.</p>
        <a v-if="authUrl" :href="authUrl" target="jmmp-spotify-oauth" rel="noopener">Open Spotify sign-in</a>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" v-close-popup />
        <q-btn v-if="state" flat label="Start again" @click="reset" />
        <q-btn color="primary" :label="state ? 'Check sign-in' : 'Connect Spotify'" :loading="working" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { api } from "src/api";
const model=defineModel<boolean>({required:true});
const emit=defineEmits<{ added: [] }>();
const name=ref("Spotify"),clientId=ref(""),links=ref(""),error=ref<string|null>(null),state=ref(""),authUrl=ref(""),working=ref(false);
const redirectUri=`${window.location.origin}/api/sources/spotify/oauth/callback`;
let poll: ReturnType<typeof setInterval>|undefined;
function reset() { clearInterval(poll); poll=undefined; state.value=""; authUrl.value=""; error.value=null; }
watch(model, value=>{if(!value)reset();}); onBeforeUnmount(reset);
async function check() {
  if(!state.value || working.value)return;
  working.value=true;
  try {
    const result=await api.get<{status:string;error?:string}>(`/api/sources/spotify/oauth/status/${encodeURIComponent(state.value)}`);
    if(result.status==="complete"){emit("added");model.value=false;}
    else if(result.status==="error"){error.value=result.error??"Spotify sign-in failed";clearInterval(poll);}
  } catch(e){error.value=e instanceof Error?e.message:String(e);clearInterval(poll);}
  finally{working.value=false;}
}
async function submit(){
  if(state.value){await check();return;}
  error.value=null;working.value=true;
  const popup=window.open("about:blank","jmmp-spotify-oauth","width=520,height=740");
  try{
    const result=await api.post<{state:string;authUrl:string}>("/api/sources/spotify/oauth/start",{sourceName:name.value,clientId:clientId.value.trim(),uris:links.value.split(/\n/).map(x=>x.trim()).filter(Boolean)});
    state.value=result.state;authUrl.value=result.authUrl;
    if(popup)popup.location.href=result.authUrl;
    poll=setInterval(()=>void check(),1500);
  }catch(e){popup?.close();error.value=e instanceof Error?e.message:String(e);}
  finally{working.value=false;}
}
</script>
