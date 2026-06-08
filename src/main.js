import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import './styles/main.less'

const app = createApp(App)
app.use(ElementPlus)
app.mount('#app')
