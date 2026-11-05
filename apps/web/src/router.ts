import { createRouter, createWebHistory } from 'vue-router'
import AiInsights from './views/AiInsights.vue'
import AiTuning from './views/AiTuning.vue'
import PolicyDocs from './views/PolicyDocs.vue'
import RequestDetail from './views/RequestDetail.vue'
import RequestList from './views/RequestList.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: RequestList },
    { path: '/requests/:id', component: RequestDetail, props: true },
    { path: '/insights', component: AiInsights },
    { path: '/tuning', component: AiTuning },
    { path: '/policy-docs', component: PolicyDocs },
  ],
})
