SELECT md5(coalesce(string_agg(signature,'|' ORDER BY signature),''))
 FROM (
 SELECT concat_ws(':',n.nspname,c.relname,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,
 pg_get_expr(d.adbin,d.adrelid)) signature
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT LIKE 'pg_%'
 AND n.nspname<>'information_schema'
 UNION ALL SELECT concat_ws(':',n.nspname,c.relname,pg_get_constraintdef(k.oid))
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
 UNION ALL SELECT concat_ws(':',schemaname,tablename,indexname,indexdef) FROM pg_indexes
 WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema'
 ) shapes
